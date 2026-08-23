import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
    chmodSync,
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    readdirSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { ELECTRON_RUNTIME_CONTRACT, type ElectronRuntimeContract } from '../electronRuntimeContract';
import {
    ELECTRON_FFMPEG_BUILD_INPUTS,
    assembleReleaseProof,
    type ReleaseBuildRunner,
    validateReleaseProof,
} from '../releaseProof';

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
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

function arm64MachO(arch: 'arm64' | 'x64'): Buffer {
    const value = Buffer.alloc(32);
    value.writeUInt32LE(0xfeedfacf, 0);
    value.writeUInt32LE(arch === 'arm64' ? 0x0100000c : 0x01000007, 4);
    return value;
}

function createDesktopZip(fixture: Fixture, archiveDirectory: string, options: DesktopOptions = {}): string {
    const appName = options.appName ?? 'Sourdaw.app';
    const packageRoot = join(fixture.base, 'desktop-package');
    const appRoot = join(packageRoot, appName);
    write(
        join(appRoot, 'Contents/Info.plist'),
        '<plist><dict><key>CFBundleExecutable</key><string>Sourdaw</string></dict></plist>'
    );
    const executable = join(appRoot, 'Contents/MacOS/Sourdaw');
    const framework = join(appRoot, 'Contents/Frameworks/Sourdaw Framework.framework/Versions/A/Sourdaw Framework');
    write(executable, arm64MachO(options.arch ?? 'arm64'));
    write(framework, arm64MachO(options.arch ?? 'arm64'));
    chmodSync(executable, 0o755);
    chmodSync(framework, 0o755);
    const resources = join(appRoot, 'Contents/Resources');
    write(join(resources, 'app.asar'), 'fixture application archive');
    const nativeAddon = join(resources, 'sourdaw-native.node');
    write(nativeAddon, arm64MachO(options.arch ?? 'arm64'));
    chmodSync(nativeAddon, 0o755);
    for (const path of ['Apache-2.0.txt', 'DEPENDENCY-LICENSES.txt', 'SOURDAW-NOTICE.txt']) {
        write(join(resources, `legal/${path}`), readFileSync(join(fixture.root, 'public/legal', path)));
    }
    write(join(resources, 'legal/electron-LICENSE.txt'), 'fixture Electron license');
    write(join(resources, 'legal/electron-LICENSES.chromium.html'), 'fixture Electron bundled notices');
    for (const path of ['ELECTRON-SOURCES.json', 'RELINKING.md', 'THIRD-PARTY-NOTICES.md']) {
        write(join(resources, `legal/${path}`), readFileSync(join(fixture.root, 'public/legal', path)));
    }
    mkdirSync(archiveDirectory, { recursive: true });
    const archive = join(archiveDirectory, options.artifactName ?? 'Sourdaw-1.0.0-mac-arm64.zip');
    execFileSync('zip', ['-X', '-q', '-r', archive, appName], { cwd: packageRoot });
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
    write(join(root, 'package.json'), '{}\n');
    write(
        join(root, '.gitignore'),
        'dist/\nelectron/out/\nrelease/desktop/\n/crates/sourdaw-native/*.node\n/crates/sourdaw-native/*.dylib\n'
    );
    write(join(root, 'LICENSE'), 'fixture license\n');
    write(join(root, 'NOTICE'), 'fixture notice\n');
    writeJson(join(root, 'release/open-source-inventory.json'), {});
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
    for (const path of ['Apache-2.0.txt', 'DEPENDENCY-LICENSES.txt', 'THIRD-PARTY-NOTICES.md']) {
        write(join(webDist, `legal/${path}`), readFileSync(join(fixture.root, 'public/legal', path)));
    }
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

function assemble(fixture: Fixture, buildRunner: ReleaseBuildRunner = fixtureBuildRunner(fixture)): void {
    assembleReleaseProof(
        fixture.root,
        fixture.candidate,
        fixture.electronSource,
        fixture.ffmpegSource,
        fixture.contract,
        buildRunner
    );
}

function proof(fixture: Fixture): Record<string, unknown> {
    return JSON.parse(readFileSync(join(fixture.candidate, 'release-proof.json'), 'utf8')) as Record<string, unknown>;
}

function desktopProof(value: Record<string, unknown>): Record<string, unknown> {
    return value.desktop as Record<string, unknown>;
}

function refreshProofHash(fixture: Fixture, field: string, path: string): void {
    const value = proof(fixture);
    desktopProof(value)[field] = hash(join(fixture.candidate, path));
    writeJson(join(fixture.candidate, 'release-proof.json'), value);
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
    it('rejects a malformed proof manifest', () => {
        const fixture = createFixture();
        assemble(fixture);
        write(join(fixture.candidate, 'release-proof.json'), '{');
        expect(validate(fixture)).toContain('release-proof.json: malformed JSON');
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
            write(join(fixture.root, 'release/desktop/Sourdaw-1.0.0-mac-arm64.zip'), 'not a ZIP');
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
        ['wrong architecture', { arch: 'x64' as const }, /not a thin arm64 Mach-O/u],
        ['wrong application layout', { appName: 'Other.app' }, /exactly one top-level Sourdaw.app/u],
    ])('rejects a desktop ZIP with %s', (_label, options, message) => {
        const fixture = createFixture(options);
        expect(() => assemble(fixture)).toThrow(message);
    });

    it('clears foreign ignored outputs and snapshots only the sequential builds', () => {
        const fixture = createFixture();
        write(join(fixture.root, 'dist/index.html'), 'foreign web output');
        write(join(fixture.root, 'release/desktop/Sourdaw-foreign-mac-arm64.zip'), 'foreign desktop output');
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
        ['a wrongly named ZIP', 'wrong', /wrong macOS arm64 identity/u],
    ])('rejects a desktop build producing %s', (_label, result, message) => {
        const fixture = createFixture();
        const runner: ReleaseBuildRunner = (phase) => {
            if (phase === 'web') {
                writeWebBuild(fixture);
                return;
            }
            if (result === 'multiple') {
                createDesktopZip(fixture, join(fixture.root, 'release/desktop'));
                createDesktopZip(fixture, join(fixture.root, 'release/desktop'), {
                    artifactName: 'Sourdaw-2.0.0-mac-arm64.zip',
                });
            } else if (result === 'wrong') {
                createDesktopZip(fixture, join(fixture.root, 'release/desktop'), {
                    artifactName: 'Foreign-1.0.0-mac-arm64.zip',
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
        expect(() => assemble(fixture, runner)).toThrow('release build changed tracked source files');
        expect(existsSync(fixture.candidate)).toBe(false);
        expect(readdirSync(fixture.base).some((name) => name.startsWith('.candidate.tmp-'))).toBe(false);
    });

    it('rejects unreferenced files outside the closed candidate census', () => {
        const fixture = createFixture();
        assemble(fixture);
        write(join(fixture.candidate, 'desktop/stale-output.zip'), 'stale');
        expect(validate(fixture)).toContain('release candidate file census contains missing or unreferenced files');
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

    it('rejects a runtime source archive under an unpinned basename', () => {
        const fixture = createFixture();
        assemble(fixture);
        const value = proof(fixture);
        const desktop = desktopProof(value);
        const oldPath = desktop.electronSourcePath as string;
        const newPath = 'desktop/caller-electron-source.tar.gz';
        write(join(fixture.candidate, newPath), readFileSync(join(fixture.candidate, oldPath)));
        rmSync(join(fixture.candidate, oldPath));
        desktop.electronSourcePath = newPath;
        writeJson(join(fixture.candidate, 'release-proof.json'), value);
        expect(validate(fixture)).toContain(
            `desktop material basename must be electron-${fixture.contract.revision}.tar.gz`
        );
    });

    it('accepts a complete candidate assembled from the exact artifacts and Git commits', () => {
        const fixture = createFixture();
        assemble(fixture);
        expect(validate(fixture)).toBe('');
        const value = proof(fixture);
        expect(desktopProof(value).artifactPath).toBe('desktop/Sourdaw-1.0.0-mac-arm64.zip');
        expect(() => readFileSync(join(fixture.candidate, 'desktop/contents'))).toThrow();
        expect(readFileSync(join(fixture.candidate, 'release-proof.json'), 'utf8')).toContain(fixture.revision);
    });
});
