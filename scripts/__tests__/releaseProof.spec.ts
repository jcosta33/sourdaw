import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { ELECTRON_RUNTIME_CONTRACT, type ElectronRuntimeContract } from '../electronRuntimeContract';
import { assembleReleaseProof, validateReleaseProof } from '../releaseProof';

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const roots: string[] = [];
const revision = 'a'.repeat(40);

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

function mapFiles(root: string): Record<string, string> {
    const result: Record<string, string> = {};
    const entries = execFileSync('find', ['.', '-type', 'f', '-print'], { cwd: root, encoding: 'utf8' })
        .split('\n')
        .filter(Boolean)
        .map((path) => path.slice(2))
        .sort();
    for (const path of entries) result[path] = hash(join(root, path));
    return result;
}

function createArchive(root: string, archive: string, directory: string): void {
    mkdirSync(dirname(archive), { recursive: true });
    execFileSync('tar', ['-czf', archive, '-C', root, directory]);
}

function createZip(root: string, archive: string): void {
    const files = execFileSync('find', ['.', '-type', 'f', '-print'], { cwd: root, encoding: 'utf8' });
    execFileSync('zip', ['-X', '-q', archive, '-@'], { cwd: root, input: files });
}

function buildCandidate(): { root: string; candidate: string; proof: string; contract: ElectronRuntimeContract } {
    const root = mkdtempSync(join(workspaceRoot, 'release-proof-fixture-'));
    roots.push(root);
    const repository = join(root, 'repository');
    const candidate = join(root, 'candidate');
    mkdirSync(repository, { recursive: true });
    mkdirSync(candidate, { recursive: true });

    const contract = structuredClone(ELECTRON_RUNTIME_CONTRACT);
    const license = 'fixture Electron license';
    const notices = 'fixture Electron bundled notices';
    contract.licenseSha256 = hashValue(license);
    contract.targets = contract.targets.map((target) =>
        target.platform === 'darwin' && target.arch === 'arm64'
            ? { ...target, sha256: 'c'.repeat(64), noticesSha256: hashValue(notices) }
            : target
    );
    contract.ffmpeg = { ...contract.ffmpeg, revision: 'e'.repeat(40) };
    write(join(repository, 'public/legal/ELECTRON-SOURCES.json'), `${JSON.stringify(contract, null, 4)}\n`);
    write(join(repository, 'public/legal/RELINKING.md'), 'fixture relinking instructions');
    write(join(repository, 'public/legal/THIRD-PARTY-NOTICES.md'), 'fixture third-party notices');
    write(join(repository, 'public/legal/Apache-2.0.txt'), 'fixture Apache license');
    write(join(repository, 'public/legal/DEPENDENCY-LICENSES.txt'), 'fixture dependency licenses');
    write(join(repository, 'public/legal/SOURDAW-NOTICE.txt'), 'fixture Sourdaw notice');
    write(join(repository, 'package.json'), '{}\n');
    write(join(repository, 'LICENSE'), 'fixture license\n');
    write(join(repository, 'NOTICE'), 'fixture notice\n');
    write(join(repository, 'release/open-source-inventory.json'), '{}\n');
    writeJson(join(repository, 'release/web-artifact-manifest.json'), {
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
    writeJson(join(repository, 'release/desktop-runtime-material.json'), {
        schemaVersion: 1,
        kind: 'desktop-runtime-material',
        artifact: 'darwin-arm64',
        runtimeManifest: 'ELECTRON-SOURCES.json',
        requiredMaterial: { ffmpegSource: 'ffmpeg-source.tar.gz', ffmpegBuild: 'ffmpeg-build.json' },
        ffmpeg: {
            repository: contract.ffmpeg.repository,
            revision: contract.ffmpeg.revision,
            license: contract.ffmpeg.license,
            buildOutputs: ['libffmpeg.dylib', 'libffmpeg.so', 'ffmpeg.dll'],
        },
    });

    const sourceTree = join(root, `sourdaw-${revision}`);
    for (const path of [
        'package.json',
        'LICENSE',
        'NOTICE',
        'release/open-source-inventory.json',
        'public/legal/ELECTRON-SOURCES.json',
        'release/desktop-runtime-material.json',
    ]) {
        write(join(sourceTree, path), `fixture ${path}`);
    }
    const sourceArchive = join(candidate, 'source/sourdaw-source.tar.gz');
    createArchive(root, sourceArchive, `sourdaw-${revision}`);
    const sourceManifest = join(candidate, 'source/source-manifest.json');
    writeJson(sourceManifest, {
        schemaVersion: 1,
        artifact: 'source',
        sourceRevision: revision,
        archiveSha256: hash(sourceArchive),
    });

    const webContents = join(candidate, 'web/contents');
    write(join(webContents, 'index.html'), '<!doctype html>');
    write(join(webContents, 'assets/app.js'), 'console.log("fixture");');
    for (const path of ['Apache-2.0.txt', 'DEPENDENCY-LICENSES.txt', 'THIRD-PARTY-NOTICES.md']) {
        write(join(webContents, `legal/${path}`), readFileSync(join(repository, 'public/legal', path)));
    }
    const webManifest = join(webContents, 'web-artifact-manifest.json');
    writeJson(webManifest, {
        schemaVersion: 1,
        artifact: 'web',
        sourceRevision: revision,
        buildCommand: 'pnpm build',
        files: mapFiles(webContents),
    });
    const webArchive = join(candidate, 'web/sourdaw-web.zip');
    createZip(webContents, webArchive);

    const desktopContents = join(candidate, 'desktop/contents');
    for (const path of ['Apache-2.0.txt', 'DEPENDENCY-LICENSES.txt', 'SOURDAW-NOTICE.txt']) {
        write(join(desktopContents, `legal/${path}`), readFileSync(join(repository, 'public/legal', path)));
    }
    write(join(desktopContents, 'legal/electron-LICENSE.txt'), license);
    write(join(desktopContents, 'legal/electron-LICENSES.chromium.html'), notices);
    write(
        join(desktopContents, 'legal/ELECTRON-SOURCES.json'),
        readFileSync(join(repository, 'public/legal/ELECTRON-SOURCES.json'))
    );
    write(join(desktopContents, 'legal/RELINKING.md'), readFileSync(join(repository, 'public/legal/RELINKING.md')));
    write(
        join(desktopContents, 'legal/THIRD-PARTY-NOTICES.md'),
        readFileSync(join(repository, 'public/legal/THIRD-PARTY-NOTICES.md'))
    );
    const desktopContentsManifest = join(candidate, 'desktop/desktop-contents-manifest.json');
    writeJson(desktopContentsManifest, {
        schemaVersion: 1,
        artifact: 'desktop-contents',
        sourceRevision: revision,
        requiredFiles: [
            'legal/Apache-2.0.txt',
            'legal/DEPENDENCY-LICENSES.txt',
            'legal/SOURDAW-NOTICE.txt',
            'legal/electron-LICENSE.txt',
            'legal/electron-LICENSES.chromium.html',
            'legal/ELECTRON-SOURCES.json',
            'legal/RELINKING.md',
            'legal/THIRD-PARTY-NOTICES.md',
        ],
        files: mapFiles(desktopContents),
    });
    const desktopArtifact = join(candidate, 'desktop/Sourdaw-mac-arm64.dmg');
    write(desktopArtifact, 'macOS arm64 fixture');
    const runtimeManifest = join(candidate, 'desktop/ELECTRON-SOURCES.json');
    write(runtimeManifest, readFileSync(join(repository, 'public/legal/ELECTRON-SOURCES.json')));
    const ffmpegSource = join(candidate, 'desktop/ffmpeg-source.tar.gz');
    write(join(root, 'ffmpeg-source/COPYING.LGPLv2.1'), 'LGPL source fixture');
    createArchive(root, ffmpegSource, 'ffmpeg-source');
    const ffmpegBuild = join(candidate, 'desktop/ffmpeg-build.json');
    writeJson(ffmpegBuild, {
        schemaVersion: 1,
        artifact: 'electron-ffmpeg-build',
        sourceRevision: contract.ffmpeg.revision,
        sourceArchiveSha256: hash(ffmpegSource),
        electronVersion: contract.version,
        electronRevision: contract.revision,
        buildInputs: ['Chromium DEPS', 'Electron build configuration'],
        buildCommand: 'autoninja -C out/Release third_party/ffmpeg:ffmpeg',
        outputs: ['libffmpeg.dylib', 'libffmpeg.so', 'ffmpeg.dll'],
    });

    const proof = join(candidate, 'release-proof.json');
    writeJson(proof, {
        schemaVersion: 1,
        sourceRevision: revision,
        source: {
            archivePath: 'source/sourdaw-source.tar.gz',
            archiveSha256: hash(sourceArchive),
            manifestPath: 'source/source-manifest.json',
            manifestSha256: hash(sourceManifest),
        },
        web: {
            archivePath: 'web/sourdaw-web.zip',
            archiveSha256: hash(webArchive),
            contentsPath: 'web/contents',
            manifestPath: 'web/contents/web-artifact-manifest.json',
            manifestSha256: hash(webManifest),
        },
        desktop: {
            platform: 'darwin',
            arch: 'arm64',
            artifactPath: 'desktop/Sourdaw-mac-arm64.dmg',
            artifactSha256: hash(desktopArtifact),
            contentsPath: 'desktop/contents',
            contentsManifestPath: 'desktop/desktop-contents-manifest.json',
            contentsManifestSha256: hash(desktopContentsManifest),
            runtimeManifestPath: 'desktop/ELECTRON-SOURCES.json',
            runtimeManifestSha256: hash(runtimeManifest),
            ffmpegSourcePath: 'desktop/ffmpeg-source.tar.gz',
            ffmpegSourceSha256: hash(ffmpegSource),
            ffmpegBuildPath: 'desktop/ffmpeg-build.json',
            ffmpegBuildSha256: hash(ffmpegBuild),
        },
    });
    execFileSync('git', ['init', '--quiet'], { cwd: repository });
    execFileSync('git', ['add', '.'], { cwd: repository });
    execFileSync(
        'git',
        ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-qm', 'fixture'],
        { cwd: repository }
    );
    return { root: repository, candidate, proof, contract };
}

afterEach(() => {
    for (const root of roots.splice(0)) {
        rmSync(join(root, 'repository/.git'), { recursive: true, force: true });
        rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
    }
});

describe('release proof', () => {
    it('rejects malformed proof JSON', () => {
        const { root, candidate, proof, contract } = buildCandidate();
        write(proof, '{');
        expect(
            validateReleaseProof({ root, candidate, expectedRevision: revision, runtimeContract: contract }).join('\n')
        ).toContain('release-proof.json: malformed JSON');
    });

    it('rejects a stale source revision', () => {
        const { root, candidate, proof, contract } = buildCandidate();
        const value = JSON.parse(readFileSync(proof, 'utf8')) as Record<string, unknown>;
        value.sourceRevision = 'b'.repeat(40);
        writeJson(proof, value);
        expect(
            validateReleaseProof({ root, candidate, expectedRevision: revision, runtimeContract: contract }).join('\n')
        ).toContain('sourceRevision does not match');
    });

    it('rejects missing FFmpeg source material', () => {
        const { root, candidate, contract } = buildCandidate();
        rmSync(join(candidate, 'desktop/ffmpeg-source.tar.gz'));
        expect(
            validateReleaseProof({ root, candidate, expectedRevision: revision, runtimeContract: contract }).join('\n')
        ).toContain('FFmpeg source material: file is missing');
    });

    it('rejects mismatched desktop legal bytes', () => {
        const { root, candidate, contract } = buildCandidate();
        write(join(candidate, 'desktop/contents/legal/RELINKING.md'), 'changed');
        expect(
            validateReleaseProof({ root, candidate, expectedRevision: revision, runtimeContract: contract }).join('\n')
        ).toContain('desktop legal file legal/RELINKING.md is missing or drifted');
    });

    it('accepts a complete candidate with matching source, web, desktop, and runtime material', () => {
        const { root, candidate, contract } = buildCandidate();
        expect(
            validateReleaseProof({ root, candidate, expectedRevision: revision, runtimeContract: contract }).join('\n')
        ).toBe('');
    });

    it('assembles a candidate from the clean source revision and concrete artifacts', () => {
        const { root, candidate, contract } = buildCandidate();
        const webDist = join(root, '../web-dist');
        const desktopArtifact = join(root, '../Sourdaw-mac-arm64.dmg');
        const desktopContents = join(root, '../desktop-contents');
        const output = join(root, '../assembled-candidate');
        write(join(webDist, 'index.html'), '<!doctype html>');
        write(join(webDist, 'assets/app.js'), 'console.log("assembled");');
        for (const path of ['Apache-2.0.txt', 'DEPENDENCY-LICENSES.txt', 'THIRD-PARTY-NOTICES.md']) {
            write(join(webDist, `legal/${path}`), readFileSync(join(root, 'public/legal', path)));
        }
        write(desktopArtifact, 'assembled desktop');
        for (const path of ['Apache-2.0.txt', 'DEPENDENCY-LICENSES.txt', 'SOURDAW-NOTICE.txt']) {
            write(join(desktopContents, `legal/${path}`), readFileSync(join(root, 'public/legal', path)));
        }
        write(join(desktopContents, 'legal/electron-LICENSE.txt'), 'fixture Electron license');
        write(join(desktopContents, 'legal/electron-LICENSES.chromium.html'), 'fixture Electron bundled notices');
        for (const path of ['ELECTRON-SOURCES.json', 'RELINKING.md', 'THIRD-PARTY-NOTICES.md']) {
            write(join(desktopContents, `legal/${path}`), readFileSync(join(root, 'public/legal', path)));
        }
        const ffmpegSource = join(root, '../assembled-ffmpeg-source.tar.gz');
        write(join(root, '../assembled-ffmpeg-source/COPYING.LGPLv2.1'), 'LGPL source fixture');
        createArchive(dirname(ffmpegSource), ffmpegSource, 'assembled-ffmpeg-source');
        const ffmpegBuild = join(root, '../assembled-ffmpeg-build.json');
        writeJson(ffmpegBuild, {
            schemaVersion: 1,
            artifact: 'electron-ffmpeg-build',
            sourceRevision: contract.ffmpeg.revision,
            sourceArchiveSha256: hash(ffmpegSource),
            electronVersion: contract.version,
            electronRevision: contract.revision,
            buildInputs: ['Chromium DEPS'],
            buildCommand: 'autoninja -C out/Release third_party/ffmpeg:ffmpeg',
            outputs: ['libffmpeg.dylib', 'libffmpeg.so', 'ffmpeg.dll'],
        });
        assembleReleaseProof(
            root,
            output,
            webDist,
            desktopArtifact,
            desktopContents,
            ffmpegSource,
            ffmpegBuild,
            contract
        );
        const assembledRevision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
        expect(
            validateReleaseProof({
                root,
                candidate: output,
                expectedRevision: assembledRevision,
                runtimeContract: contract,
            })
        ).toEqual([]);
        expect(readFileSync(join(output, 'release-proof.json'), 'utf8')).toContain(assembledRevision);
        expect(candidate).toContain('candidate');
    });
});
