import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, relative, sep } from 'node:path';

import { windowsPrivateCache } from './windowsCache.mjs';

export function nativeTypeScriptIdentity() {
    const identity = JSON.parse(readFileSync(new URL('./identity.json', import.meta.url), 'utf8'));
    const patch = readFileSync(new URL('./compiler.patch', import.meta.url));
    if (sha256(patch) !== identity.patchSha256)
        throw new Error('Native TypeScript source patch does not match its identity');
    return identity;
}

export function sha256(bytes) {
    return createHash('sha256').update(bytes).digest('hex');
}

export function nativeTypeScriptCacheRoot() {
    const root =
        process.env.SOURDAW_NATIVE_TS_CACHE ||
        (process.platform === 'win32'
            ? windowsPrivateCache({ operation: 'default-root' })
            : join(homedir(), '.cache', 'sourdaw', 'typescript-native'));
    if (!isAbsolute(root)) throw new Error('SOURDAW_NATIVE_TS_CACHE must be an absolute private cache path');
    return root;
}

export function nativeTypeScriptCacheDirectory(identity = nativeTypeScriptIdentity()) {
    return join(
        nativeTypeScriptCacheRoot(),
        `${identity.upstreamCommit}-${sha256(JSON.stringify(identity))}`,
        `${process.platform}-${process.arch}`
    );
}

// This validates the complete dependency section emitted from the actual built binary.
// A build may link only part of the selected graph on a particular host.
export function nativeTypeScriptBuildModules(buildInfo, identity = nativeTypeScriptIdentity()) {
    if (typeof buildInfo !== 'string' || !buildInfo.split('\n')[0].endsWith(`: ${identity.goVersion}`))
        throw new Error('Native compiler build information has the wrong Go version');
    const lines = buildInfo.split(/\r?\n/);
    if (!lines.includes('\tpath\tgithub.com/microsoft/typescript-go/cmd/tsgo'))
        throw new Error('Native compiler build information has the wrong program');
    const modules = [];
    const seen = new Set();
    for (const line of lines) {
        if (line.startsWith('\t=>')) throw new Error('Native compiler build has a replaced Go module');
        if (!line.startsWith('\tdep\t')) continue;
        const fields = line.split('\t');
        const [, , path, version, sum] = fields;
        const expected = identity.goModules.find((module) => module.path === path);
        if (fields.length !== 5 || seen.has(path) || !expected || expected.version !== version || expected.sum !== sum)
            throw new Error('Native compiler build does not match its patched Go module graph');
        seen.add(path);
        modules.push({ path, version, sum });
    }
    if (modules.length === 0) throw new Error('Native compiler build has no dependency information');
    return modules;
}

function requirePrivateCacheEntry(path, kind) {
    if (typeof process.getuid !== 'function')
        throw new Error('Native private-cache ownership verification is not implemented for this host');
    const info = lstatSync(path);
    if (info.isSymbolicLink() || info.uid !== process.getuid() || (info.mode & 0o077) !== 0)
        throw new Error(`Native compiler cache entry is not owned/private: ${path}`);
    if (kind === 'directory' ? !info.isDirectory() : !info.isFile())
        throw new Error(`Native compiler cache entry has the wrong kind: ${path}`);
    if (kind === 'executable' && (info.mode & 0o100) === 0)
        throw new Error(`Native compiler cache executable is not executable: ${path}`);
}

export function ensurePrivateNativeTypeScriptDirectory(path) {
    const root = nativeTypeScriptCacheRoot();
    const child = relative(root, path);
    if (child === '..' || child.startsWith(`..${sep}`) || isAbsolute(child))
        throw new Error('Cannot create a compiler directory outside the private cache');
    if (process.platform === 'win32') return windowsPrivateCache({ operation: 'create', root, path });
    // Validate an existing fence before the preparation lock or any staged write.
    if (existsSync(root)) requirePrivateCacheEntry(root, 'directory');
    else {
        mkdirSync(root, { recursive: true, mode: 0o700 });
        requirePrivateCacheEntry(root, 'directory');
    }
    let current = root;
    for (const segment of child.split(sep).filter(Boolean)) {
        current = join(current, segment);
        // Do not follow an existing intermediate link before checking it.
        try {
            requirePrivateCacheEntry(current, 'directory');
        } catch (error) {
            if (error?.code !== 'ENOENT') throw error;
            mkdirSync(current, { mode: 0o700 });
            requirePrivateCacheEntry(current, 'directory');
        }
    }
    return path;
}

// This resolver never downloads, builds, starts a compiler or imports a compiler
// API. It can be read while constructing a guarded command without a bootstrap
// dependency on ESLint, TypeScript, or the native service being prepared.
export function getPreparedNativeTypeScriptPath() {
    const identity = nativeTypeScriptIdentity();
    const directory = nativeTypeScriptCacheDirectory(identity);
    const binary = join(directory, process.platform === 'win32' ? 'tsgo.exe' : 'tsgo');
    try {
        const root = nativeTypeScriptCacheRoot();
        const entries = [
            { path: join(directory, '..'), kind: 'directory' },
            { path: directory, kind: 'directory' },
            { path: join(directory, 'receipt.json'), kind: 'file' },
            { path: binary, kind: 'executable' },
        ];
        if (process.platform === 'win32') windowsPrivateCache({ operation: 'verify', root, entries });
        else {
            requirePrivateCacheEntry(root, 'directory');
            for (const { path, kind } of entries) requirePrivateCacheEntry(path, kind);
        }
        const receipt = JSON.parse(readFileSync(join(directory, 'receipt.json'), 'utf8'));
        for (const field of [
            'upstreamVersion',
            'upstreamCommit',
            'upstreamTree',
            'patchSha256',
            'protocol',
            'goVersion',
            'goModSha256',
            'goSumSha256',
            'sourceArchiveSha256',
            'patchedGoModSha256',
            'patchedGoSumSha256',
        ]) {
            if (receipt[field] !== identity[field]) throw new Error(`receipt ${field} mismatch`);
        }
        if (
            receipt.schemaVersion !== 2 ||
            receipt.locallyPatched !== true ||
            receipt.platform !== process.platform ||
            receipt.arch !== process.arch
        )
            throw new Error('receipt host/schema mismatch');
        const goOS = process.platform === 'win32' ? 'windows' : process.platform;
        const goArch =
            process.arch === 'x64'
                ? 'amd64'
                : process.arch === 'ia32'
                  ? '386'
                  : process.arch === 'arm'
                    ? 'armv6l'
                    : process.arch;
        const archive = identity.goFiles.find((file) => file.os === goOS && file.arch === goArch);
        if (!archive || archive.sha256 !== receipt.goArchiveSha256) throw new Error('receipt Go archive mismatch');
        if (receipt.identitySha256 !== sha256(JSON.stringify(identity))) throw new Error('receipt identity mismatch');
        if (JSON.stringify(receipt.goModules) !== JSON.stringify(identity.goModules))
            throw new Error('receipt selected Go module graph mismatch');
        const compiledGoModules = nativeTypeScriptBuildModules(receipt.buildInfo, identity);
        if (JSON.stringify(receipt.compiledGoModules) !== JSON.stringify(compiledGoModules))
            throw new Error('receipt compiled Go module graph mismatch');
        if (receipt.capabilityProbe?.method !== 'getAwaitedType' || receipt.capabilityProbe?.result !== 'void')
            throw new Error('missing real native awaited-type probe');
        if (sha256(readFileSync(binary)) !== receipt.binarySha256) throw new Error('prepared binary hash mismatch');
        return binary;
    } catch (error) {
        throw new Error(
            `Prepared locally patched TypeScript ${identity.upstreamVersion} is unavailable for ${process.platform}-${process.arch}. Run pnpm native:typescript:prepare in this job (agent sessions: pnpm guard --profile broad --max-rss-mib 4096 -- pnpm native:typescript:prepare). Cache: ${directory}`,
            { cause: error }
        );
    }
}
