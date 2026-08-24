import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
    chmodSync,
    cpSync,
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    readdirSync,
    renameSync,
    rmSync,
    symlinkSync,
    truncateSync,
    writeFileSync,
} from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

import { afterEach, describe, expect, it } from 'vitest';

import { ELECTRON_RUNTIME_CONTRACT, type ElectronRuntimeContract } from '../electronRuntimeContract';
import {
    ELECTRON_FFMPEG_BUILD_INPUTS,
    RELEASE_PROOF_ARCHIVE_LIMITS,
    RELEASE_PROOF_TYPE_LIMITS,
    assembleReleaseProof,
    webLlmRequiredLegalFiles,
    type ReleaseBuildRunner,
    validateReleaseProof,
} from '../releaseProof';

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const WEBLLM_REQUIRED_LEGAL_FILES = webLlmRequiredLegalFiles(workspaceRoot);
const WEBLLM_REQUIRED_SOURCE_LEGAL_FILES = WEBLLM_REQUIRED_LEGAL_FILES.map((path) => `public/${path}`);
const WEBLLM_PACKAGED_PATH_LIST_DIGEST = '03220ef72279533c5110dea8cad8b087065c2232238096c6cc50cf3f48a10603';
const fixtureRoots: string[] = [];
const electronRepository = 'https://example.test/electron/electron';
const ffmpegRepository = 'https://example.test/chromium/ffmpeg';

type Fixture = {
    base: string;
    root: string;
    candidate: string;
    electronSource: string;
    ffmpegSource: string;
    contract: ElectronRuntimeContract;
    revision: string;
    desktopOptions: DesktopOptions;
};

type DesktopOptions = {
    arch?: 'arm64' | 'x64';
    appName?: string;
    artifactName?: string;
    fuses?: 'valid' | 'invalid' | 'missing';
    fusePaddingBytes?: number;
    invalidLoadCommands?: boolean;
    oversizedLoadCommands?: boolean;
    nativeFileType?: number;
    packagedFfmpegArch?: 'arm64' | 'x64';
    packagedFfmpeg?: 'valid' | 'missing' | 'different';
    runtimeFfmpeg?: 'matching' | 'missing' | 'different';
    renderer?: 'matching' | 'mutated' | 'missing';
    asarHeader?: 'valid' | 'oversized';
    symlink?: 'contained' | 'escaping' | 'none';
};

function hash(path: string): string {
    return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function hashValue(value: string): string {
    return createHash('sha256').update(value).digest('hex');
}

function write(path: string, value: string | Buffer): void {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, value);
}

function writeJson(path: string, value: unknown): void {
    write(path, `${JSON.stringify(value, null, 4)}\n`);
}

function git(repository: string, args: readonly string[]): string {
    return execFileSync('git', [...args], { cwd: repository, encoding: 'utf8' }).trim();
}

function commit(repository: string, message: string): string {
    git(repository, ['add', '.']);
    execFileSync(
        'git',
        ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-qm', message],
        { cwd: repository }
    );
    return git(repository, ['rev-parse', 'HEAD']);
}

function createRepository(base: string, name: string, remote: string, files: Record<string, string>): string {
    const repository = join(base, name);
    mkdirSync(repository, { recursive: true });
    execFileSync('git', ['init', '--quiet'], { cwd: repository });
    execFileSync('git', ['remote', 'add', 'origin', remote], { cwd: repository });
    for (const [path, value] of Object.entries(files)) {
        write(join(repository, path), value);
    }
    commit(repository, 'fixture source');
    return repository;
}

function desktopMaterial(contract: ElectronRuntimeContract): unknown {
    return {
        schemaVersion: 1,
        kind: 'desktop-runtime-material',
        artifact: 'darwin-arm64',
        runtimeManifest: 'ELECTRON-SOURCES.json',
        requiredMaterial: {
            electronSource: `electron-${contract.revision}.tar.gz`,
            electronCommit: `electron-${contract.revision}.commit`,
            ffmpegSource: `ffmpeg-${contract.ffmpeg.revision}.tar.gz`,
            ffmpegCommit: `ffmpeg-${contract.ffmpeg.revision}.commit`,
            ffmpegBuild: 'ffmpeg-build-material.json',
            buildInputs: 'build-inputs/electron',
        },
        electron: {
            repository: contract.repository,
            revision: contract.revision,
            buildInputs: ELECTRON_FFMPEG_BUILD_INPUTS,
        },
        ffmpeg: {
            repository: contract.ffmpeg.repository,
            revision: contract.ffmpeg.revision,
            license: contract.ffmpeg.license,
        },
        build: {
            configureCommand:
                'TARGET_ARCH=arm64 e init -f --root=. --out=Default release --import release --target-cpu arm64',
            command: 'TARGET_ARCH=arm64 e build --target electron:release_build',
            target: 'electron:release_build',
            output: 'src/out/Default/Electron Framework.framework/Libraries/libffmpeg.dylib',
        },
    };
}

function arm64MachO(
    arch: 'arm64' | 'x64',
    fileType: number,
    options: {
        fuses?: 'valid' | 'invalid' | 'missing';
        fusePaddingBytes?: number;
        invalidLoadCommands?: boolean;
        oversizedLoadCommands?: boolean;
    } = {}
): Buffer {
    const commandSize = 72;
    const fuseStates = Buffer.from([48, 49, 48, 48, 49, 49, 48, options.fuses === 'invalid' ? 49 : 48, 48]);
    const fuseWire =
        options.fuses === 'missing'
            ? Buffer.alloc(0)
            : Buffer.concat([Buffer.from('dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX'), Buffer.from([1, 9]), fuseStates]);
    const fusePadding = Buffer.alloc(options.fusePaddingBytes ?? 0);
    const value = Buffer.alloc(32 + commandSize + fusePadding.length + fuseWire.length);
    value.writeUInt32LE(0xfeedfacf, 0);
    value.writeUInt32LE(arch === 'arm64' ? 0x0100000c : 0x01000007, 4);
    value.writeUInt32LE(fileType, 12);
    value.writeUInt32LE(1, 16);
    value.writeUInt32LE(
        options.oversizedLoadCommands === true ? RELEASE_PROOF_TYPE_LIMITS.machLoadCommandBytes + 1 : commandSize,
        20
    );
    value.writeUInt32LE(0x19, 32);
    value.writeUInt32LE(options.invalidLoadCommands === true ? commandSize + 8 : commandSize, 36);
    fuseWire.copy(value, 32 + commandSize + fusePadding.length);
    return value;
}

function createDesktopZip(fixture: Fixture, archiveDirectory: string, options: DesktopOptions = {}): string {
    const appName = options.appName ?? 'Sourdaw.app';
    const packageRoot = join(fixture.base, 'desktop-package');
    rmSync(packageRoot, { recursive: true, force: true });
    const appRoot = join(packageRoot, appName);
    write(
        join(appRoot, 'Contents/Info.plist'),
        '<plist><dict><key>CFBundleExecutable</key><string>Sourdaw</string></dict></plist>'
    );
    const executable = join(appRoot, 'Contents/MacOS/Sourdaw');
    const framework = join(appRoot, 'Contents/Frameworks/Sourdaw Framework.framework/Versions/A/Sourdaw Framework');
    write(executable, arm64MachO(options.arch ?? 'arm64', 2, { invalidLoadCommands: options.invalidLoadCommands }));
    write(
        framework,
        arm64MachO(options.arch ?? 'arm64', 6, {
            fuses: options.fuses ?? 'valid',
            fusePaddingBytes: options.fusePaddingBytes,
            invalidLoadCommands: options.invalidLoadCommands,
            oversizedLoadCommands: options.oversizedLoadCommands,
        })
    );
    chmodSync(executable, 0o755);
    chmodSync(framework, 0o755);
    const resources = join(appRoot, 'Contents/Resources');
    if (!existsSync(join(fixture.root, 'dist'))) {
        writeWebBuild(fixture, 'desktop');
    }
    const asarSource = join(fixture.base, 'desktop-asar-source');
    rmSync(asarSource, { recursive: true, force: true });
    cpSync(join(fixture.root, 'dist'), join(asarSource, 'dist'), { recursive: true });
    if (options.renderer === 'mutated') {
        write(join(asarSource, 'dist/assets/app.js'), 'console.log("foreign renderer");');
    } else if (options.renderer === 'missing') {
        rmSync(join(asarSource, 'dist/assets/app.js'));
    }
    execFileSync(resolve(workspaceRoot, 'node_modules/.bin/asar'), ['pack', asarSource, join(resources, 'app.asar')]);
    if (options.asarHeader === 'oversized') {
        const asar = join(resources, 'app.asar');
        const bytes = readFileSync(asar);
        bytes.writeUInt32LE(RELEASE_PROOF_TYPE_LIMITS.asarHeaderBytes + 1, 4);
        writeFileSync(asar, bytes);
    }
    const nativeAddon = join(resources, 'sourdaw-native.node');
    write(nativeAddon, arm64MachO(options.arch ?? 'arm64', options.nativeFileType ?? 8));
    chmodSync(nativeAddon, 0o755);
    const packagedFfmpeg = join(
        appRoot,
        'Contents/Frameworks/Sourdaw Framework.framework/Versions/A/Libraries/libffmpeg.dylib'
    );
    const packagedFfmpegBytes = arm64MachO(options.packagedFfmpegArch ?? options.arch ?? 'arm64', 6);
    if (options.packagedFfmpeg !== 'missing') {
        write(
            packagedFfmpeg,
            options.packagedFfmpeg === 'different'
                ? Buffer.concat([packagedFfmpegBytes, Buffer.from('packaged')])
                : packagedFfmpegBytes
        );
    }
    const runtimeFfmpeg = join(
        fixture.root,
        'node_modules/electron/dist/Electron.app/Contents/Frameworks/Electron Framework.framework/Versions/A/Libraries/libffmpeg.dylib'
    );
    if (options.runtimeFfmpeg !== 'missing') {
        write(
            runtimeFfmpeg,
            options.runtimeFfmpeg === 'different'
                ? Buffer.concat([packagedFfmpegBytes, Buffer.from('runtime')])
                : packagedFfmpegBytes
        );
    }
    if (options.symlink !== 'none') {
        const current = join(appRoot, 'Contents/Frameworks/Sourdaw Framework.framework/Versions/Current');
        mkdirSync(dirname(current), { recursive: true });
        symlinkSync(options.symlink === 'escaping' ? '../../../../../../outside' : 'A', current);
    }
    for (const path of ['Apache-2.0.txt', 'DEPENDENCY-LICENSES.txt', 'SOURDAW-NOTICE.txt']) {
        write(join(resources, `legal/${path}`), readFileSync(join(fixture.root, 'public/legal', path)));
    }
    write(join(resources, 'legal/electron-LICENSE.txt'), 'fixture Electron license');
    write(join(resources, 'legal/electron-LICENSES.chromium.html'), 'fixture Electron bundled notices');
    for (const path of ['ELECTRON-SOURCES.json', 'RELINKING.md', 'THIRD-PARTY-NOTICES.md']) {
        write(join(resources, `legal/${path}`), readFileSync(join(fixture.root, 'public/legal', path)));
    }
    for (const path of WEBLLM_REQUIRED_LEGAL_FILES) {
        write(join(resources, path), readFileSync(join(fixture.root, 'public', path)));
    }
    mkdirSync(archiveDirectory, { recursive: true });
    const archive = join(archiveDirectory, options.artifactName ?? 'Sourdaw-1.0.0-arm64-mac.zip');
    execFileSync('zip', ['-X', '-y', '-q', '-r', archive, appName], { cwd: packageRoot });
    return archive;
}

function createFixture(options: DesktopOptions = {}): Fixture {
    const base = mkdtempSync(join(workspaceRoot, 'release-proof-fixture-'));
    fixtureRoots.push(base);

    const ffmpegSource = createRepository(base, 'ffmpeg', ffmpegRepository, {
        'BUILD.gn': 'shared_library("ffmpeg") {}\n',
        'COPYING.LGPLv2.1': 'fixture LGPL source\n',
        'libavcodec/codec.c': 'int codec(void) { return 1; }\n',
    });
    const ffmpegRevision = git(ffmpegSource, ['rev-parse', 'HEAD']);
    const electronFiles = Object.fromEntries(
        ELECTRON_FFMPEG_BUILD_INPUTS.map((path) => [path, `fixture Electron input ${path}\n`])
    );
    electronFiles.DEPS = `'ffmpeg_revision': '${ffmpegRevision}'\n`;
    const electronSource = createRepository(base, 'electron', electronRepository, electronFiles);
    const electronRevision = git(electronSource, ['rev-parse', 'HEAD']);

    const contract = structuredClone(ELECTRON_RUNTIME_CONTRACT);
    contract.repository = electronRepository;
    contract.revision = electronRevision;
    contract.licenseSha256 = hashValue('fixture Electron license');
    contract.ffmpeg = { ...contract.ffmpeg, repository: ffmpegRepository, revision: ffmpegRevision };
    contract.targets = contract.targets.map((target) =>
        target.platform === 'darwin' && target.arch === 'arm64'
            ? { ...target, noticesSha256: hashValue('fixture Electron bundled notices') }
            : target
    );

    const root = join(base, 'repository');
    mkdirSync(root, { recursive: true });
    writeJson(join(root, 'public/legal/ELECTRON-SOURCES.json'), contract);
    write(join(root, 'public/legal/RELINKING.md'), 'fixture relinking instructions');
    write(join(root, 'public/legal/THIRD-PARTY-NOTICES.md'), 'fixture third-party notices');
    write(join(root, 'public/legal/Apache-2.0.txt'), 'fixture Apache license');
    write(join(root, 'public/legal/DEPENDENCY-LICENSES.txt'), 'fixture dependency licenses');
    write(join(root, 'public/legal/SOURDAW-NOTICE.txt'), 'fixture Sourdaw notice');
    for (const [index, path] of WEBLLM_REQUIRED_LEGAL_FILES.entries()) {
        write(join(root, 'public', path), `fixture WebLLM legal file ${String(index)}\n`);
    }
    write(join(root, 'package.json'), '{"version":"1.0.0"}\n');
    write(
        join(root, '.gitignore'),
        'dist/\nelectron/out/\nrelease/desktop/\nnode_modules/\n/crates/sourdaw-native/*.node\n/crates/sourdaw-native/*.dylib\n'
    );
    write(join(root, 'LICENSE'), 'fixture license\n');
    write(join(root, 'NOTICE'), 'fixture notice\n');
    writeJson(join(root, 'release/open-source-inventory.json'), {
        schemaVersion: 1,
        surfaces: [
            {
                id: 'webllm-qwen-artifacts',
                paths: WEBLLM_REQUIRED_SOURCE_LEGAL_FILES,
            },
        ],
    });
    writeJson(join(root, 'release/desktop-runtime-material.json'), desktopMaterial(contract));
    writeJson(join(root, 'release/web-artifact-manifest.json'), {
        schemaVersion: 1,
        kind: 'web-artifact-manifest',
        artifact: 'web',
        hashAlgorithm: 'sha256',
        buildCommand: 'pnpm build',
        outputDirectory: 'dist',
        manifestFile: 'web-artifact-manifest.json',
        sourceRevisionField: 'sourceRevision',
        binding: 'release-proof.json',
        requiredFiles: ['index.html', 'assets/', 'legal/'],
    });
    execFileSync('git', ['init', '--quiet'], { cwd: root });
    execFileSync('git', ['remote', 'add', 'origin', 'https://example.test/sourdaw/sourdaw'], { cwd: root });
    const revision = commit(root, 'fixture release');

    return {
        base,
        root,
        candidate: join(base, 'candidate'),
        electronSource,
        ffmpegSource,
        contract,
        revision,
        desktopOptions: options,
    };
}

function writeWebBuild(fixture: Fixture, marker = 'current'): void {
    const webDist = join(fixture.root, 'dist');
    write(join(webDist, 'index.html'), `<!doctype html><title>${marker}</title>`);
    write(join(webDist, 'assets/app.js'), `console.log("${marker}");`);
    for (const path of ['legal/DEPENDENCY-LICENSES.txt', ...WEBLLM_REQUIRED_LEGAL_FILES]) {
        write(join(webDist, path), readFileSync(join(fixture.root, 'public', path)));
    }
}

function rewriteDesktopArchive(fixture: Fixture, mutate: (root: string) => void): void {
    const value = proof(fixture);
    const archive = join(fixture.candidate, desktopProof(value).artifactPath as string);
    const extracted = join(fixture.base, 'mutated-desktop-archive');
    rmSync(extracted, { recursive: true, force: true });
    mkdirSync(extracted, { recursive: true });
    execFileSync('unzip', ['-qq', archive, '-d', extracted]);
    mutate(extracted);
    rmSync(archive);
    execFileSync('zip', ['-X', '-y', '-q', '-r', archive, 'Sourdaw.app'], { cwd: extracted });
}

function fixtureBuildRunner(fixture: Fixture): ReleaseBuildRunner {
    return (phase) => {
        if (phase === 'web') {
            writeWebBuild(fixture);
            return;
        }
        createDesktopZip(fixture, join(fixture.root, 'release/desktop'), fixture.desktopOptions);
    };
}

function assemble(
    fixture: Fixture,
    buildRunner: ReleaseBuildRunner = fixtureBuildRunner(fixture),
    releaseGate: (root: string) => void = () => undefined
): void {
    assembleReleaseProof(
        fixture.root,
        fixture.candidate,
        fixture.electronSource,
        fixture.ffmpegSource,
        fixture.contract,
        buildRunner,
        releaseGate
    );
}

function proof(fixture: Fixture): Record<string, unknown> {
    return JSON.parse(readFileSync(join(fixture.candidate, 'release-proof.json'), 'utf8')) as Record<string, unknown>;
}

function desktopProof(value: Record<string, unknown>): Record<string, unknown> {
    return value.desktop as Record<string, unknown>;
}

function webProof(value: Record<string, unknown>): Record<string, unknown> {
    return value.web as Record<string, unknown>;
}

function refreshProofHash(fixture: Fixture, field: string, path: string): void {
    const value = proof(fixture);
    desktopProof(value)[field] = hash(join(fixture.candidate, path));
    writeJson(join(fixture.candidate, 'release-proof.json'), value);
}

function refreshWebArchiveHash(fixture: Fixture): void {
    const value = proof(fixture);
    const web = webProof(value);
    web.archiveSha256 = hash(join(fixture.candidate, web.archivePath as string));
    writeJson(join(fixture.candidate, 'release-proof.json'), value);
}

function replaceWebArchive(fixture: Fixture, paths: readonly string[]): string {
    const root = join(fixture.base, 'bounded-web-archive');
    rmSync(root, { recursive: true, force: true });
    for (const path of paths) {
        write(join(root, path), 'x');
    }
    const archive = join(fixture.candidate, 'web/sourdaw-web.zip');
    rmSync(archive);
    execFileSync('zip', ['-X', '-q', archive, ...paths], { cwd: root });
    refreshWebArchiveHash(fixture);
    return archive;
}

function patchZipMetadata(
    archive: string,
    patch: (bytes: Buffer, centralOffset: number, entryCount: number) => void
): void {
    const bytes = readFileSync(archive);
    const end = bytes.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    if (end === -1) {
        throw new Error('fixture ZIP is missing an end of central directory');
    }
    const entryCount = bytes.readUInt16LE(end + 10);
    patch(bytes, bytes.readUInt32LE(end + 16), entryCount);
    writeFileSync(archive, bytes);
}

function replaceSourceArchiveWithGitMetadata(fixture: Fixture, marker: string, directory = '.git'): void {
    const value = proof(fixture);
    const source = value.source as Record<string, unknown>;
    const archive = join(fixture.candidate, source.archivePath as string);
    const extracted = join(fixture.base, 'source-with-git-metadata');
    mkdirSync(extracted, { recursive: true });
    execFileSync('tar', ['-xzf', archive, '-C', extracted]);
    const root = join(extracted, `sourdaw-${fixture.revision}`);
    write(join(root, '.gitattributes'), 'trigger filter=escape\n');
    write(join(root, 'trigger'), 'fixture');
    write(join(root, directory, 'config'), `[filter "escape"]\n\tclean = sh -c 'touch "${marker}"'\n`);
    rmSync(archive);
    execFileSync('tar', ['-czf', archive, basename(root)], { cwd: extracted });
    source.archiveSha256 = hash(archive);
    const manifestPath = join(fixture.candidate, source.manifestPath as string);
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>;
    manifest.archiveSha256 = source.archiveSha256;
    writeJson(manifestPath, manifest);
    source.manifestSha256 = hash(manifestPath);
    writeJson(join(fixture.candidate, 'release-proof.json'), value);
}

function refreshSourceArchiveHash(fixture: Fixture): string {
    const value = proof(fixture);
    const source = value.source as Record<string, unknown>;
    const archive = join(fixture.candidate, source.archivePath as string);
    source.archiveSha256 = hash(archive);
    const manifestPath = join(fixture.candidate, source.manifestPath as string);
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>;
    manifest.archiveSha256 = source.archiveSha256;
    writeJson(manifestPath, manifest);
    source.manifestSha256 = hash(manifestPath);
    writeJson(join(fixture.candidate, 'release-proof.json'), value);
    return archive;
}

function oversizedTarHeader(size: number): Buffer {
    const header = Buffer.alloc(512);
    header.write('oversized', 0);
    header.write('0000644\0', 100);
    header.write('0000000\0', 108);
    header.write('0000000\0', 116);
    header.write(`${size.toString(8).padStart(11, '0')}\0`, 124);
    header.write('00000000000\0', 136);
    header.fill(0x20, 148, 156);
    header.write('0', 156);
    header.write('ustar\0', 257);
    header.write('00', 263);
    const checksum = header.reduce((total, byte) => total + byte, 0);
    header.write(`${checksum.toString(8).padStart(6, '0')}\0 `, 148);
    return gzipSync(header);
}

function validate(fixture: Fixture): string {
    return validateReleaseProof({
        root: fixture.root,
        candidate: fixture.candidate,
        expectedRevision: fixture.revision,
        runtimeContract: fixture.contract,
    }).join('\n');
}

afterEach(() => {
    for (const root of fixtureRoots.splice(0)) {
        rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
    }
});

describe('release proof', () => {
    it('pins the WebLLM packaged legal path list', () => {
        expect(hashValue(JSON.stringify([...WEBLLM_REQUIRED_LEGAL_FILES].sort()))).toBe(
            WEBLLM_PACKAGED_PATH_LIST_DIGEST
        );
    });

    it('rejects a malformed proof manifest', () => {
        const fixture = createFixture();
        assemble(fixture);
        write(join(fixture.candidate, 'release-proof.json'), '{');
        expect(validate(fixture)).toContain('release-proof.json: malformed JSON');
    });

    it('caps whole-buffer JSON and commit-object reads before parsing', () => {
        const fixture = createFixture();
        assemble(fixture);
        const proofPath = join(fixture.candidate, 'release-proof.json');
        const originalProof = readFileSync(proofPath);
        truncateSync(proofPath, RELEASE_PROOF_TYPE_LIMITS.jsonBytes + 1);
        expect(validate(fixture)).toContain('JSON document exceeds');
        writeFileSync(proofPath, originalProof);

        const value = proof(fixture);
        const source = value.source as Record<string, unknown>;
        const commitPath = join(fixture.candidate, source.commitPath as string);
        truncateSync(commitPath, RELEASE_PROOF_TYPE_LIMITS.commitObjectBytes + 1);
        source.commitSha256 = hash(commitPath);
        const manifestPath = join(fixture.candidate, source.manifestPath as string);
        const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>;
        manifest.commitObjectSha256 = source.commitSha256;
        writeJson(manifestPath, manifest);
        source.manifestSha256 = hash(manifestPath);
        writeJson(proofPath, value);
        expect(validate(fixture)).toContain('source commit object exceeds');
    });

    it('rejects a stale candidate revision', () => {
        const fixture = createFixture();
        assemble(fixture);
        const value = proof(fixture);
        value.sourceRevision = '0'.repeat(40);
        writeJson(join(fixture.candidate, 'release-proof.json'), value);
        expect(validate(fixture)).toContain('sourceRevision does not match');
    });

    it('rejects random bytes renamed as a desktop ZIP', () => {
        const fixture = createFixture();
        const runner: ReleaseBuildRunner = (phase) => {
            if (phase === 'web') {
                writeWebBuild(fixture);
                return;
            }
            writeWebBuild(fixture, 'desktop');
            write(join(fixture.root, 'release/desktop/Sourdaw-1.0.0-arm64-mac.zip'), 'not a ZIP');
        };
        expect(() => assemble(fixture, runner)).toThrow(/zip archive is unreadable|desktop archive/u);
    });

    it('rejects a desktop census not derived from the packaged archive', () => {
        const fixture = createFixture();
        assemble(fixture);
        const manifestPath = join(fixture.candidate, 'desktop/desktop-contents-manifest.json');
        const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>;
        const files = manifest.files as Record<string, string>;
        files['legal/RELINKING.md'] = '0'.repeat(64);
        writeJson(manifestPath, manifest);
        refreshProofHash(fixture, 'contentsManifestSha256', 'desktop/desktop-contents-manifest.json');
        expect(validate(fixture)).toContain('desktop archive resource census or digest does not match');
    });

    it('rejects fabricated renderer and packaged libffmpeg receipt hashes', () => {
        const fixture = createFixture();
        assemble(fixture);
        const manifestPath = join(fixture.candidate, 'desktop/desktop-contents-manifest.json');
        const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>;
        const receipt = manifest.buildReceipt as Record<string, unknown>;
        (receipt.rendererFiles as Record<string, string>)['assets/app.js'] = '0'.repeat(64);
        manifest.packagedFfmpegSha256 = '0'.repeat(64);
        writeJson(manifestPath, manifest);
        refreshProofHash(fixture, 'contentsManifestSha256', 'desktop/desktop-contents-manifest.json');
        expect(validate(fixture)).toMatch(
            /desktop build receipt does not match|desktop contents manifest is not bound/u
        );
    });

    it('rejects candidate files reached through a containing-directory symlink escape', () => {
        const fixture = createFixture();
        assemble(fixture);
        const outside = join(fixture.base, 'outside-web-contents');
        cpSync(join(fixture.candidate, 'web/contents'), outside, { recursive: true });
        rmSync(join(fixture.candidate, 'web/contents'), { recursive: true });
        symlinkSync(outside, join(fixture.candidate, 'web/contents'));
        expect(validate(fixture)).toMatch(/path escapes its containing directory|symbolic links are forbidden/u);
    });

    it('rejects candidate-side file symlinks even when their target bytes match', () => {
        const fixture = createFixture();
        assemble(fixture);
        const material = join(fixture.candidate, 'desktop/ELECTRON-SOURCES.json');
        const outside = join(fixture.base, 'outside-electron-sources.json');
        cpSync(material, outside);
        rmSync(material);
        symlinkSync(outside, material);
        expect(validate(fixture)).toMatch(/symbolic links are forbidden|file is missing/u);
    });

    it('rejects a web ZIP whose same-named entry bytes differ from web contents', () => {
        const fixture = createFixture();
        assemble(fixture);
        const archive = join(fixture.candidate, 'web/sourdaw-web.zip');
        const extracted = join(fixture.base, 'mutated-web-archive');
        const paths = execFileSync('unzip', ['-Z1', archive], { encoding: 'utf8' }).trim().split('\n').sort();
        mkdirSync(extracted, { recursive: true });
        execFileSync('unzip', ['-qq', archive, '-d', extracted]);
        write(join(extracted, 'assets/app.js'), 'console.log("mutated archive only");');
        rmSync(archive);
        execFileSync('zip', ['-X', '-q', archive, '-@'], {
            cwd: extracted,
            input: `${paths.join('\n')}\n`,
        });
        const value = proof(fixture);
        webProof(value).archiveSha256 = hash(archive);
        writeJson(join(fixture.candidate, 'release-proof.json'), value);
        expect(validate(fixture)).toContain('web archive bytes do not match web contents for assets/app.js');
    });

    it('rejects candidates that omit the Qwen legal notice from both packaged surfaces', () => {
        const fixture = createFixture();
        assemble(fixture);
        rmSync(join(fixture.candidate, 'web/contents/legal/Qwen-NOTICE.txt'));
        rewriteDesktopArchive(fixture, (root) => {
            rmSync(join(root, 'Sourdaw.app/Contents/Resources/legal/Qwen-NOTICE.txt'));
        });

        expect(validate(fixture)).toMatch(
            /web WebLLM legal file legal\/Qwen-NOTICE\.txt is missing or drifted[\s\S]*desktop WebLLM legal file legal\/Qwen-NOTICE\.txt is missing or drifted/u
        );
    });

    it('rejects candidates that omit a nested tvm-ffi legal file from both packaged surfaces', () => {
        const fixture = createFixture();
        assemble(fixture);
        rmSync(join(fixture.candidate, 'web/contents/legal/Apache-TVM/3rdparty/tvm-ffi/licenses/LICENSE.dlpack.txt'));
        rewriteDesktopArchive(fixture, (root) => {
            rmSync(
                join(
                    root,
                    'Sourdaw.app/Contents/Resources/legal/Apache-TVM/3rdparty/tvm-ffi/licenses/LICENSE.dlpack.txt'
                )
            );
        });

        expect(validate(fixture)).toMatch(
            /web WebLLM legal file legal\/Apache-TVM\/3rdparty\/tvm-ffi\/licenses\/LICENSE\.dlpack\.txt is missing or drifted[\s\S]*desktop WebLLM legal file legal\/Apache-TVM\/3rdparty\/tvm-ffi\/licenses\/LICENSE\.dlpack\.txt is missing or drifted/u
        );
    });

    it('rejects an inventory-derived WebLLM legal file whose web contents bytes drift', () => {
        const fixture = createFixture();
        const legalFile = WEBLLM_REQUIRED_LEGAL_FILES[0]!;
        assemble(fixture);
        write(join(fixture.candidate, 'web/contents', legalFile), 'drifted web legal bytes');

        const errors = validate(fixture);
        expect(errors).toContain(`web WebLLM legal file ${legalFile} is missing or drifted`);
        expect(errors).not.toContain(`desktop WebLLM legal file ${legalFile} is missing or drifted`);
    });

    it('rejects an inventory-derived WebLLM legal file whose desktop archive bytes drift', () => {
        const fixture = createFixture();
        const legalFile = WEBLLM_REQUIRED_LEGAL_FILES[0]!;
        assemble(fixture);
        rewriteDesktopArchive(fixture, (root) => {
            write(join(root, 'Sourdaw.app/Contents/Resources', legalFile), 'drifted desktop legal bytes');
        });

        const errors = validate(fixture);
        expect(errors).toContain(`desktop WebLLM legal file ${legalFile} is missing or drifted`);
        expect(errors).not.toContain(`web WebLLM legal file ${legalFile} is missing or drifted`);
    });

    it('rejects FFmpeg source checked out at the wrong commit', () => {
        const fixture = createFixture();
        write(join(fixture.ffmpegSource, 'wrong.c'), 'int wrong(void) { return 1; }\n');
        commit(fixture.ffmpegSource, 'wrong revision');
        expect(() => assemble(fixture)).toThrow('FFmpeg source checkout HEAD does not match the pinned revision');
    });

    it('rejects fabricated FFmpeg build material', () => {
        const fixture = createFixture();
        assemble(fixture);
        const path = join(fixture.candidate, 'desktop/ffmpeg-build-material.json');
        const material = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
        (material.commands as Record<string, unknown>).target = 'caller:invented';
        writeJson(path, material);
        refreshProofHash(fixture, 'ffmpegBuildSha256', 'desktop/ffmpeg-build-material.json');
        expect(validate(fixture)).toContain('was not generated from the pinned Electron and FFmpeg sources');
    });

    it.each([
        ['missing', (path: string) => rmSync(path)],
        ['mutated', (path: string) => write(path, 'caller-authored bytes')],
    ])('rejects %s exact Electron build inputs', (_label, mutate) => {
        const fixture = createFixture();
        assemble(fixture);
        const input = join(fixture.candidate, 'desktop/build-inputs/electron/build/args/release.gn');
        mutate(input);
        expect(validate(fixture)).toMatch(/Electron FFmpeg build inputs|does not match the source archive/u);
    });

    it('rejects missing corresponding FFmpeg source', () => {
        const fixture = createFixture();
        assemble(fixture);
        const value = proof(fixture);
        const path = desktopProof(value).ffmpegSourcePath as string;
        rmSync(join(fixture.candidate, path));
        expect(validate(fixture)).toContain('FFmpeg source archive: file is missing');
    });

    it.each([
        ['wrong architecture', { arch: 'x64' as const }, /not a valid thin arm64 Mach-O/u],
        ['wrong application layout', { appName: 'Other.app' }, /exactly one top-level Sourdaw.app/u],
    ])('rejects a desktop ZIP with %s', (_label, options, message) => {
        const fixture = createFixture(options);
        expect(() => assemble(fixture)).toThrow(message);
    });

    it.each([
        ['malformed load commands', { invalidLoadCommands: true }, /load-command/u],
        ['wrong native addon file type', { nativeFileType: 6 }, /desktop native addon.*file type/u],
        ['wrong REQUIRED_FUSES', { fuses: 'invalid' as const }, /REQUIRED_FUSES mismatch/u],
    ])('rejects a package with %s', (_label, options, message) => {
        const fixture = createFixture(options);
        expect(() => assemble(fixture)).toThrow(message);
    });

    it('caps Mach-O load-command and ASAR metadata reads before allocation', () => {
        const fixture = createFixture({ oversizedLoadCommands: true, asarHeader: 'oversized' });
        expect(() => assemble(fixture)).toThrow(
            /load-command table exceeds the read limit[\s\S]*ASAR metadata header exceeds the read limit/u
        );
    });

    it.each([
        ['missing packaged libffmpeg', { packagedFfmpeg: 'missing' as const }, /packaged libffmpeg.*missing/u],
        ['non-arm64 packaged libffmpeg', { packagedFfmpegArch: 'x64' as const }, /packaged libffmpeg.*CPU type/u],
        [
            'different packaged and installed libffmpeg bytes',
            { packagedFfmpeg: 'different' as const },
            /does not match the installed Electron runtime/u,
        ],
        ['missing installed libffmpeg', { runtimeFfmpeg: 'missing' as const }, /installed Electron runtime.*invalid/u],
    ])('rejects %s', (_label, options, message) => {
        const fixture = createFixture(options);
        expect(() => assemble(fixture)).toThrow(message);
    });

    it.each([
        ['mutated renderer bytes', { renderer: 'mutated' as const }],
        ['missing renderer bytes', { renderer: 'missing' as const }],
    ])('rejects app.asar with %s relative to the desktop build dist', (_label, options) => {
        const fixture = createFixture(options);
        expect(() => assemble(fixture)).toThrow(/app\.asar renderer (?:does not match|is missing)/u);
    });

    it('preserves contained package symlinks and rejects package link escapes', () => {
        const valid = createFixture({ symlink: 'contained' });
        assemble(valid);
        expect(validate(valid)).toBe('');

        const escaped = createFixture({ symlink: 'escaping' });
        expect(() => assemble(escaped)).toThrow(/symbolic link.*escapes the package/u);
    });

    it('clears foreign ignored outputs and snapshots only the sequential builds', () => {
        const fixture = createFixture();
        write(join(fixture.root, 'dist/index.html'), 'foreign web output');
        write(join(fixture.root, 'release/desktop/Sourdaw-foreign-arm64-mac.zip'), 'foreign desktop output');
        const phases: string[] = [];
        const runner: ReleaseBuildRunner = (phase) => {
            phases.push(phase);
            if (phase === 'web') {
                expect(existsSync(join(fixture.root, 'dist/index.html'))).toBe(false);
                writeWebBuild(fixture, 'fresh-web');
                return;
            }
            expect(existsSync(join(fixture.root, 'dist'))).toBe(false);
            expect(existsSync(join(fixture.root, 'release/desktop'))).toBe(false);
            createDesktopZip(fixture, join(fixture.root, 'release/desktop'));
        };
        assemble(fixture, runner);
        expect(phases).toEqual(['web', 'desktop']);
        expect(readFileSync(join(fixture.candidate, 'web/contents/index.html'), 'utf8')).toContain('fresh-web');
        expect(readFileSync(join(fixture.candidate, 'release-proof.json'), 'utf8')).not.toContain('foreign');
    });

    it.each([
        ['zero ZIPs', 'zero', /no release directory|exactly one new ZIP/u],
        ['multiple ZIPs', 'multiple', /exactly one new ZIP/u],
        ['a reversed mac-arm64 ZIP', 'wrong', /wrong macOS arm64 identity/u],
    ])('rejects a desktop build producing %s', (_label, result, message) => {
        const fixture = createFixture();
        const runner: ReleaseBuildRunner = (phase) => {
            if (phase === 'web') {
                writeWebBuild(fixture);
                return;
            }
            writeWebBuild(fixture, 'desktop');
            if (result === 'multiple') {
                createDesktopZip(fixture, join(fixture.root, 'release/desktop'));
                createDesktopZip(fixture, join(fixture.root, 'release/desktop'), {
                    artifactName: 'Sourdaw-2.0.0-arm64-mac.zip',
                });
            } else if (result === 'wrong') {
                createDesktopZip(fixture, join(fixture.root, 'release/desktop'), {
                    artifactName: 'Sourdaw-1.0.0-mac-arm64.zip',
                });
            }
        };
        expect(() => assemble(fixture, runner)).toThrow(message);
        expect(existsSync(fixture.candidate)).toBe(false);
    });

    it('rejects tracked source changes made by a build and leaves no partial candidate', () => {
        const fixture = createFixture();
        const runner: ReleaseBuildRunner = (phase) => {
            if (phase === 'web') {
                writeWebBuild(fixture);
                write(join(fixture.root, 'package.json'), '{"changed":true}\n');
            }
        };
        expect(() => assemble(fixture, runner)).toThrow('release build changed source files');
        expect(existsSync(fixture.candidate)).toBe(false);
        expect(readdirSync(fixture.base).some((name) => name.startsWith('.candidate.tmp-'))).toBe(false);
    });

    it('rejects untracked non-ignored source files created by a build', () => {
        const fixture = createFixture();
        const runner: ReleaseBuildRunner = (phase) => {
            if (phase === 'web') {
                writeWebBuild(fixture);
                write(join(fixture.root, 'build-created-source.ts'), 'export const foreign = true;\n');
            }
        };
        expect(() => assemble(fixture, runner)).toThrow('release build changed source files');
        expect(existsSync(fixture.candidate)).toBe(false);
    });

    it('runs the aggregate release gate before publication and removes the temporary candidate on failure', () => {
        const fixture = createFixture();
        let gated = false;
        const gate = (): never => {
            gated = true;
            expect(git(fixture.root, ['rev-parse', 'HEAD'])).toBe(fixture.revision);
            expect(git(fixture.root, ['status', '--porcelain'])).toBe('');
            throw new Error('aggregate release gate failed');
        };
        expect(() => assemble(fixture, fixtureBuildRunner(fixture), gate)).toThrow('aggregate release gate failed');
        expect(gated).toBe(true);
        expect(existsSync(fixture.candidate)).toBe(false);
        expect(readdirSync(fixture.base).some((name) => name.startsWith('.candidate.tmp-'))).toBe(false);
    });

    it('rejects unreferenced files outside the closed candidate census', () => {
        const fixture = createFixture();
        assemble(fixture);
        write(join(fixture.candidate, 'desktop/stale-output.zip'), 'stale');
        expect(validate(fixture)).toContain('release candidate file census contains missing or unreferenced files');
    });

    it('bounds candidate traversal depth and aggregate bytes without recursion or large fixtures', () => {
        const fixture = createFixture();
        assemble(fixture);
        const sparseBytes = Math.floor(RELEASE_PROOF_ARCHIVE_LIMITS.expandedBytes / 2) + 1;
        const first = join(fixture.candidate, 'sparse-a');
        const second = join(fixture.candidate, 'sparse-b');
        write(first, '');
        write(second, '');
        truncateSync(first, sparseBytes);
        truncateSync(second, sparseBytes);
        expect(validate(fixture)).toContain('release candidate: traversal exceeds the aggregate byte limit');
        rmSync(first);
        rmSync(second);

        const deep = `${Array.from({ length: RELEASE_PROOF_ARCHIVE_LIMITS.pathDepth + 1 }, () => 'deep').join('/')}/file`;
        write(join(fixture.candidate, deep), 'bounded');
        expect(validate(fixture)).toContain('release candidate: traversal contains a path exceeding the depth limit');
    });

    it('rejects build tree claims not derived from pinned commit objects', () => {
        const fixture = createFixture();
        assemble(fixture);
        const path = join(fixture.candidate, 'desktop/ffmpeg-build-material.json');
        const material = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
        (material.electron as Record<string, unknown>).treeSha1 = '0'.repeat(40);
        writeJson(path, material);
        refreshProofHash(fixture, 'ffmpegBuildSha256', 'desktop/ffmpeg-build-material.json');
        expect(validate(fixture)).toContain('was not generated from the pinned Electron and FFmpeg sources');
    });

    it('rejects relocation of every canonical desktop material path', () => {
        const fixture = createFixture();
        assemble(fixture);
        const value = proof(fixture);
        const desktop = desktopProof(value);
        for (const field of [
            'artifactPath',
            'contentsManifestPath',
            'runtimeManifestPath',
            'electronSourcePath',
            'electronCommitPath',
            'ffmpegSourcePath',
            'ffmpegCommitPath',
            'ffmpegBuildPath',
            'buildInputsPath',
        ]) {
            const originalPath = desktop[field] as string;
            const relocatedPath = `desktop/relocated/${basename(originalPath)}`;
            mkdirSync(dirname(join(fixture.candidate, relocatedPath)), { recursive: true });
            renameSync(join(fixture.candidate, originalPath), join(fixture.candidate, relocatedPath));
            desktop[field] = relocatedPath;
            writeJson(join(fixture.candidate, 'release-proof.json'), value);
            expect(validate(fixture)).toContain(`desktop material path must be ${originalPath}`);
            renameSync(join(fixture.candidate, relocatedPath), join(fixture.candidate, originalPath));
            desktop[field] = originalPath;
        }
    });

    it('fails validation closed when the repository is dirty or no longer at the expected revision', () => {
        const dirty = createFixture();
        assemble(dirty);
        write(join(dirty.root, 'untracked-release-input.txt'), 'dirty');
        expect(validate(dirty)).toContain('release proof validation requires a clean worktree');

        const moved = createFixture();
        assemble(moved);
        write(join(moved.root, 'next-revision.txt'), 'next');
        commit(moved.root, 'advance fixture revision');
        expect(validate(moved)).toContain(
            'release proof validation checkout HEAD does not match the expected revision'
        );
    });

    it.each(['.git', '.GIT'])('rejects %s archive metadata before reconstructed Git execution', (directory) => {
        const fixture = createFixture();
        assemble(fixture);
        const marker = join(fixture.base, 'git-filter-ran');
        replaceSourceArchiveWithGitMetadata(fixture, marker, directory);
        expect(validate(fixture)).toContain('source archive contains repository metadata');
        expect(existsSync(marker)).toBe(false);
    });

    it('rejects ZIP archive resource metadata without expanding hostile payloads', () => {
        const tar = createFixture();
        assemble(tar);
        const tarSource = proof(tar).source as Record<string, unknown>;
        const tarArchive = join(tar.candidate, tarSource.archivePath as string);
        writeFileSync(tarArchive, oversizedTarHeader(RELEASE_PROOF_ARCHIVE_LIMITS.entryBytes + 1));
        refreshSourceArchiveHash(tar);
        expect(validate(tar)).toContain(
            'tar archive is unreadable: release archive limit exceeded: an entry exceeds the expanded-size limit'
        );

        const file = createFixture();
        assemble(file);
        const fileSource = proof(file).source as Record<string, unknown>;
        truncateSync(
            join(file.candidate, fileSource.archivePath as string),
            RELEASE_PROOF_ARCHIVE_LIMITS.candidateFileBytes + 1
        );
        expect(validate(file)).toContain('source archive: file exceeds the candidate file-size limit');

        const entry = createFixture();
        assemble(entry);
        const entryArchive = replaceWebArchive(entry, ['entry.txt']);
        patchZipMetadata(entryArchive, (bytes, centralOffset) => {
            bytes.writeUInt32LE(RELEASE_PROOF_ARCHIVE_LIMITS.entryBytes + 1, centralOffset + 24);
        });
        refreshWebArchiveHash(entry);
        expect(validate(entry)).toContain(
            'zip archive is unreadable: release archive limit exceeded: an entry exceeds the expanded-size limit'
        );

        const aggregate = createFixture();
        assemble(aggregate);
        const aggregatePaths = Array.from({ length: 11 }, (_value, index) => `file-${String(index)}.txt`);
        const aggregateArchive = replaceWebArchive(aggregate, aggregatePaths);
        patchZipMetadata(aggregateArchive, (bytes, centralOffset, entryCount) => {
            let offset = centralOffset;
            const size = Math.floor(RELEASE_PROOF_ARCHIVE_LIMITS.expandedBytes / entryCount) + 1;
            for (let index = 0; index < entryCount; index += 1) {
                bytes.writeUInt32LE(size, offset + 24);
                offset +=
                    46 +
                    bytes.readUInt16LE(offset + 28) +
                    bytes.readUInt16LE(offset + 30) +
                    bytes.readUInt16LE(offset + 32);
            }
        });
        refreshWebArchiveHash(aggregate);
        expect(validate(aggregate)).toContain(
            'zip archive is unreadable: release archive limit exceeded: aggregate expanded bytes exceed the limit'
        );

        const count = createFixture();
        assemble(count);
        const countArchive = replaceWebArchive(count, ['count.txt']);
        patchZipMetadata(countArchive, (bytes, _centralOffset) => {
            const end = bytes.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
            bytes.writeUInt16LE(RELEASE_PROOF_ARCHIVE_LIMITS.entries + 1, end + 8);
            bytes.writeUInt16LE(RELEASE_PROOF_ARCHIVE_LIMITS.entries + 1, end + 10);
        });
        refreshWebArchiveHash(count);
        expect(validate(count)).toContain(
            'zip archive is unreadable: release archive limit exceeded: entry count exceeds the limit'
        );

        const depth = createFixture();
        assemble(depth);
        const deepPath = `${Array.from({ length: RELEASE_PROOF_ARCHIVE_LIMITS.pathDepth + 1 }, () => 'deep').join('/')}/file.txt`;
        replaceWebArchive(depth, [deepPath]);
        expect(validate(depth)).toContain('web archive contains a path exceeding the depth limit');
    });

    it('rejects ZIP entry bytes that exceed their declarations', () => {
        const fixture = createFixture();
        assemble(fixture);
        const archive = replaceWebArchive(fixture, ['actual.txt']);
        patchZipMetadata(archive, (bytes, centralOffset) => {
            bytes.writeUInt32LE(0, centralOffset + 24);
        });
        refreshWebArchiveHash(fixture);
        expect(validate(fixture)).toContain('ZIP entry expanded bytes do not match its declarations');
    });

    it('hashes ZIP entries without spawning one unzip process per file', () => {
        const fixture = createFixture();
        assemble(fixture);
        const marker = join(fixture.base, 'unzip-invoked');
        const bin = join(fixture.base, 'bin');
        const unzip = join(bin, 'unzip');
        write(unzip, `#!/bin/sh\nprintf invoked > "${marker}"\nexit 99\n`);
        chmodSync(unzip, 0o755);
        const originalPath = process.env.PATH;
        process.env.PATH = `${bin}:${originalPath ?? ''}`;
        try {
            expect(validate(fixture)).toBe('');
        } finally {
            process.env.PATH = originalPath;
        }
        expect(existsSync(marker)).toBe(false);
    });

    it('accepts a complete candidate assembled from the exact artifacts and Git commits', () => {
        const fixture = createFixture();
        assemble(fixture);
        expect(validate(fixture)).toBe('');
        const value = proof(fixture);
        expect(desktopProof(value).artifactPath).toBe('desktop/Sourdaw-1.0.0-arm64-mac.zip');
        expect(() => readFileSync(join(fixture.candidate, 'desktop/contents'))).toThrow();
        expect(readFileSync(join(fixture.candidate, 'release-proof.json'), 'utf8')).toContain(fixture.revision);
    });
});
