import { createHash, randomUUID } from 'node:crypto';
import {
    chmodSync,
    createWriteStream,
    existsSync,
    mkdtempSync,
    mkdirSync,
    readFileSync,
    renameSync,
    writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

import { runCommand } from '../nativeCommand.ts';
import { acquireResourceLock } from '../resourceGuard.ts';
import {
    ensurePrivateNativeTypeScriptDirectory,
    getPreparedNativeTypeScriptPath,
    nativeTypeScriptCacheDirectory,
    nativeTypeScriptCacheRoot,
    nativeTypeScriptIdentity,
    nativeTypeScriptBuildModules,
    sha256,
} from './compiler.mjs';

// Explicit preparation only. Importers use compiler.mjs and never call this file
// automatically. Agent invocations must wrap this command in pnpm guard; CI runs
// it deliberately in the per-job runner before any native lint consumer starts.
async function prepare() {
    const identity = nativeTypeScriptIdentity();
    const root = nativeTypeScriptCacheRoot();
    const destination = nativeTypeScriptCacheDirectory(identity);
    ensurePrivateNativeTypeScriptDirectory(root);
    const lock = acquireResourceLock({ root, command: 'prepare locally patched native TypeScript' });
    try {
        if (existsSync(join(destination, 'receipt.json'))) {
            console.log(`Using verified locally patched TypeScript: ${getPreparedNativeTypeScriptPath()}`);
            return;
        }
        const stage =
            process.platform === 'win32'
                ? ensurePrivateNativeTypeScriptDirectory(join(root, `preparing-${randomUUID()}`))
                : mkdtempSync(join(root, 'preparing-'));
        const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_')));
        Object.assign(env, {
            GIT_TERMINAL_PROMPT: '0',
            GIT_CONFIG_NOSYSTEM: '1',
            GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
            GOTOOLCHAIN: 'local',
            GOENV: 'off',
            GOWORK: 'off',
            CGO_ENABLED: '0',
            GOFLAGS: '-mod=readonly',
            GOPROXY: 'https://proxy.golang.org',
            GOSUMDB: 'sum.golang.org',
            GOPRIVATE: '',
            GONOPROXY: 'none',
            GONOSUMDB: 'none',
            GOMODCACHE: join(stage, 'gomod'),
            GOCACHE: join(stage, 'gocache'),
        });

        async function run(command, args, cwd = stage) {
            const result = await runCommand(command, args, cwd, env, undefined, { timeoutMs: 20 * 60_000 });
            if (result.code !== 0 || result.signal || result.failure)
                throw new Error(
                    `${command} failed (${result.code}, ${result.signal || 'no signal'}): ${result.failure || result.output}`
                );
            return result.output.trim();
        }

        async function download(url, destination, expected) {
            const response = await fetch(url, { signal: AbortSignal.timeout(120_000) });
            if (!response.ok || !response.body)
                throw new Error(`Could not download pinned Go archive: HTTP ${response.status}`);
            const final = new URL(response.url);
            if (!['go.dev', 'dl.google.com'].includes(final.hostname) || final.protocol !== 'https:')
                throw new Error('Unexpected Go archive origin');
            const digest = createHash('sha256');
            await pipeline(
                Readable.fromWeb(response.body),
                async function* (chunks) {
                    for await (const chunk of chunks) {
                        digest.update(chunk);
                        yield chunk;
                    }
                },
                createWriteStream(destination, { flags: 'wx', mode: 0o600 })
            );
            const actual = digest.digest('hex');
            if (actual !== expected) throw new Error('Pinned official Go archive SHA256 mismatch');
            return actual;
        }

        const goOS = process.platform === 'win32' ? 'windows' : process.platform;
        const goArch =
            process.arch === 'x64'
                ? 'amd64'
                : process.arch === 'ia32'
                  ? '386'
                  : process.arch === 'arm'
                    ? 'armv6l'
                    : process.arch;
        const buildArch = process.arch === 'arm' ? 'arm' : goArch;
        Object.assign(env, { GOOS: goOS, GOARCH: buildArch, GOROOT: join(stage, 'go') });
        const archive = identity.goFiles.find((file) => file.os === goOS && file.arch === goArch);
        if (!archive)
            throw new Error(
                `No pinned official Go ${identity.goVersion} archive for build host ${process.platform}-${process.arch}`
            );
        const goArchive = join(stage, archive.filename);
        await download(`https://go.dev/dl/${archive.filename}`, goArchive, archive.sha256);
        await run(process.platform === 'win32' ? 'tar.exe' : 'tar', ['-xf', goArchive, '-C', stage]);
        const go = join(stage, 'go', 'bin', process.platform === 'win32' ? 'go.exe' : 'go');
        const goVersion = await run(go, ['version']);
        if (goVersion !== `go version ${identity.goVersion} ${goOS}/${buildArch}`)
            throw new Error('Official Go archive reports an unexpected compiler version');

        const source = join(stage, 'source');
        mkdirSync(source, { mode: 0o700 });
        await run('git', ['init', '--quiet'], source);
        await run(
            'git',
            [
                '-c',
                'credential.helper=',
                'fetch',
                '--quiet',
                '--no-tags',
                '--depth=1',
                identity.officialRepository,
                identity.upstreamCommit,
            ],
            source
        );
        await run('git', ['checkout', '--quiet', '--detach', 'FETCH_HEAD'], source);
        if ((await run('git', ['rev-parse', 'HEAD'], source)) !== identity.upstreamCommit)
            throw new Error('Native source commit mismatch');
        if ((await run('git', ['rev-parse', 'HEAD^{tree}'], source)) !== identity.upstreamTree)
            throw new Error('Native source tree mismatch');
        const sourceArchive = join(stage, 'upstream-source.tar');
        await run('git', ['archive', '--format=tar', `--output=${sourceArchive}`, identity.upstreamCommit], source);
        const sourceArchiveSha256 = sha256(readFileSync(sourceArchive));
        if (sourceArchiveSha256 !== identity.sourceArchiveSha256)
            throw new Error('Official native source archive does not match its pinned identity');
        const goModSha256 = sha256(readFileSync(join(source, 'go.mod')));
        const goSumSha256 = sha256(readFileSync(join(source, 'go.sum')));
        if (goModSha256 !== identity.goModSha256 || goSumSha256 !== identity.goSumSha256)
            throw new Error('Official native source Go module graph does not match its pinned identity');
        const patch = fileURLToPath(new URL('./compiler.patch', import.meta.url));
        await run('git', ['apply', '--check', patch], source);
        await run('git', ['apply', patch], source);
        const patchedGoModSha256 = sha256(readFileSync(join(source, 'go.mod')));
        const patchedGoSumSha256 = sha256(readFileSync(join(source, 'go.sum')));
        if (patchedGoModSha256 !== identity.patchedGoModSha256 || patchedGoSumSha256 !== identity.patchedGoSumSha256)
            throw new Error('Patched native source Go module graph does not match its pinned identity');
        await run(go, ['mod', 'download', 'all'], source);
        const moduleVerification = await run(go, ['mod', 'verify'], source);
        if (moduleVerification !== 'all modules verified')
            throw new Error('Native Go module checksum verification failed');
        const moduleGraph = await run(
            go,
            ['list', '-m', '-f', '{{if not .Main}}{{.Path}}\t{{.Version}}\t{{.Sum}}\t{{.GoModSum}}{{end}}', 'all'],
            source
        );
        const goModules = moduleGraph
            .split(/\r?\n/)
            .filter(Boolean)
            .map((line) => {
                const [path, version, sum, goModSum] = line.split('\t');
                return { path, version, sum, goModSum };
            });
        if (JSON.stringify(goModules) !== JSON.stringify(identity.goModules))
            throw new Error('Resolved native Go module graph does not match its pinned identity');
        const binaryName = process.platform === 'win32' ? 'tsgo.exe' : 'tsgo';
        const binary = join(stage, binaryName);
        const buildArgs = ['build', '-trimpath', '-o', binary, './cmd/tsgo'];
        await run(go, buildArgs, source);
        if (
            sha256(readFileSync(join(source, 'go.mod'))) !== patchedGoModSha256 ||
            sha256(readFileSync(join(source, 'go.sum'))) !== patchedGoSumSha256
        )
            throw new Error('Building the native compiler changed its pinned Go module graph');
        chmodSync(binary, 0o700);
        const buildInfo = await run(go, ['version', '-m', binary]);
        const compiledGoModules = nativeTypeScriptBuildModules(buildInfo, identity);
        const probeText = await run(
            process.execPath,
            [
                fileURLToPath(new URL('./probe.mjs', import.meta.url)),
                binary,
                process.env.SOURDAW_NATIVE_TS_PROBE_CLIENT_ROOT || '',
            ],
            process.cwd()
        );
        const capabilityProbe = JSON.parse(probeText);
        if (capabilityProbe.method !== 'getAwaitedType' || capabilityProbe.result !== 'void')
            throw new Error('Native compiler capability probe did not attest awaiting');

        const receipt = {
            schemaVersion: 2,
            upstreamVersion: identity.upstreamVersion,
            upstreamCommit: identity.upstreamCommit,
            upstreamTree: identity.upstreamTree,
            locallyPatched: true,
            identitySha256: sha256(JSON.stringify(identity)),
            patchSha256: identity.patchSha256,
            protocol: identity.protocol,
            goVersion: identity.goVersion,
            goArchiveSha256: archive.sha256,
            sourceArchiveSha256,
            goModSha256,
            goSumSha256,
            patchedGoModSha256,
            patchedGoSumSha256,
            goModules,
            compiledGoModules,
            platform: process.platform,
            arch: process.arch,
            binarySha256: sha256(readFileSync(binary)),
            buildCommand: { program: go, args: buildArgs },
            buildInfo,
            capabilityProbe,
        };
        writeFileSync(join(stage, 'receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`, {
            flag: 'wx',
            mode: 0o600,
        });
        ensurePrivateNativeTypeScriptDirectory(join(destination, '..'));
        renameSync(stage, destination);
        getPreparedNativeTypeScriptPath();
        console.log(
            `Prepared locally patched TypeScript ${identity.upstreamVersion} (${identity.protocol}) for ${process.platform}-${process.arch}`
        );
    } finally {
        lock.release();
    }
}

await prepare();
