#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
    chmodSync,
    cpSync,
    existsSync,
    mkdirSync,
    readFileSync,
    readdirSync,
    rmSync,
    statSync,
    utimesSync,
    writeFileSync,
} from 'node:fs';
import { basename, dirname, isAbsolute, join, posix, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ELECTRON_RUNTIME_CONTRACT } from './electronRuntimeContract.ts';
import { parseJsonWithUniqueKeys } from './strictJson.ts';

const SCHEMA_VERSION = 1;
const PROOF_FILE = 'release-proof.json';
const SOURCE_REQUIRED_PATHS = [
    'package.json',
    'LICENSE',
    'NOTICE',
    'release/open-source-inventory.json',
    'public/legal/ELECTRON-SOURCES.json',
    'release/desktop-runtime-material.json',
] as const;
const DESKTOP_REQUIRED_FILES = [
    'legal/Apache-2.0.txt',
    'legal/DEPENDENCY-LICENSES.txt',
    'legal/SOURDAW-NOTICE.txt',
    'legal/electron-LICENSE.txt',
    'legal/electron-LICENSES.chromium.html',
    'legal/ELECTRON-SOURCES.json',
    'legal/RELINKING.md',
    'legal/THIRD-PARTY-NOTICES.md',
] as const;
const WEB_REQUIRED_FILES = [
    'legal/Apache-2.0.txt',
    'legal/DEPENDENCY-LICENSES.txt',
    'legal/THIRD-PARTY-NOTICES.md',
] as const;
const DESKTOP_MATERIAL_NAMES = ['ELECTRON-SOURCES.json', 'ffmpeg-source.tar.gz', 'ffmpeg-build.json'] as const;

type JsonRecord = Record<string, unknown>;

export type ReleaseProofOptions = {
    root: string;
    candidate: string;
    expectedRevision: string;
    runtimeContract?: typeof ELECTRON_RUNTIME_CONTRACT;
};

function isRecord(value: unknown): value is JsonRecord {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sameValue(left: unknown, right: unknown): boolean {
    return JSON.stringify(left) === JSON.stringify(right);
}

function sha256Bytes(value: Buffer): string {
    return createHash('sha256').update(value).digest('hex');
}

function sha256File(path: string): string {
    return sha256Bytes(readFileSync(path));
}

function writeJson(path: string, value: unknown): void {
    writeFileSync(path, `${JSON.stringify(value, null, 4)}\n`);
}

function readJson(path: string): unknown {
    return parseJsonWithUniqueKeys(readFileSync(path, 'utf8'), path);
}

function requiredRecord(record: JsonRecord, key: string, label: string, errors: string[]): JsonRecord | undefined {
    const value = record[key];
    if (!isRecord(value)) {
        errors.push(`${label}.${key} must be an object`);
        return undefined;
    }
    return value;
}

function safeRelativePath(value: unknown, label: string, errors: string[]): string | undefined {
    if (typeof value !== 'string' || value.length === 0 || value.includes('\\') || value.includes('\0')) {
        errors.push(`${label} must be a non-empty POSIX relative path`);
        return undefined;
    }
    const normalized = posix.normalize(value);
    if (
        isAbsolute(value) ||
        normalized !== value ||
        value === '.' ||
        value.startsWith('../') ||
        value.includes('/../') ||
        value.endsWith('/..')
    ) {
        errors.push(`${label} must be a normalized relative path`);
        return undefined;
    }
    return value;
}

function candidatePath(root: string, value: unknown, label: string, errors: string[]): string | undefined {
    const path = safeRelativePath(value, label, errors);
    return path === undefined ? undefined : resolve(root, ...path.split('/'));
}

function verifyFileHash(
    root: string,
    pathValue: unknown,
    hashValue: unknown,
    label: string,
    errors: string[]
): string | undefined {
    const path = candidatePath(root, pathValue, `${label}.path`, errors);
    const hash = typeof hashValue === 'string' && /^[0-9a-f]{64}$/u.test(hashValue) ? hashValue : undefined;
    if (hash === undefined) {
        errors.push(`${label}.sha256 must be a lowercase SHA-256 digest`);
    }
    if (path === undefined || hash === undefined) {
        return undefined;
    }
    if (!existsSync(path) || !statSync(path).isFile()) {
        errors.push(`${label}: file is missing`);
        return undefined;
    }
    if (sha256File(path) !== hash) {
        errors.push(`${label}: digest mismatch`);
    }
    return path;
}

function listFiles(root: string, label: string, errors: string[]): string[] {
    if (!existsSync(root) || !statSync(root).isDirectory()) {
        errors.push(`${label}: directory is missing`);
        return [];
    }
    const files: string[] = [];
    const visit = (directory: string): void => {
        for (const entry of readdirSync(directory, { withFileTypes: true })) {
            const child = join(directory, entry.name);
            if (entry.isDirectory()) {
                visit(child);
            } else if (entry.isFile()) {
                files.push(relative(root, child).split(sep).join('/'));
            } else {
                errors.push(`${label}: unsupported non-file entry ${relative(root, child)}`);
            }
        }
    };
    visit(root);
    return files.sort();
}

function stringMap(value: unknown, label: string, errors: string[]): Record<string, string> {
    if (!isRecord(value)) {
        errors.push(`${label} must be an object`);
        return {};
    }
    const result: Record<string, string> = {};
    for (const [key, hash] of Object.entries(value)) {
        if (typeof hash !== 'string' || !/^[0-9a-f]{64}$/u.test(hash)) {
            errors.push(`${label}.${key} must be a lowercase SHA-256 digest`);
        } else {
            result[key] = hash;
        }
    }
    return result;
}

function verifyFileMap(
    directory: string,
    recorded: Record<string, string>,
    label: string,
    errors: string[],
    excluded: readonly string[] = []
): void {
    const actual = listFiles(directory, label, errors).filter((path) => !excluded.includes(path));
    const recordedPaths = Object.keys(recorded).sort();
    for (const path of recordedPaths) {
        safeRelativePath(path, `${label} path`, errors);
    }
    if (!sameValue(actual, recordedPaths)) {
        errors.push(`${label}: file census mismatch`);
    }
    for (const path of recordedPaths) {
        const absolute = resolve(directory, ...path.split('/'));
        if (!existsSync(absolute) || !statSync(absolute).isFile()) {
            errors.push(`${label}: missing ${path}`);
        } else if (sha256File(absolute) !== recorded[path]) {
            errors.push(`${label}: digest mismatch for ${path}`);
        }
    }
}

function readJsonForValidation(path: string, label: string, errors: string[]): JsonRecord | undefined {
    try {
        const value = readJson(path);
        if (!isRecord(value)) {
            errors.push(`${label}: JSON root must be an object`);
            return undefined;
        }
        return value;
    } catch (error) {
        errors.push(`${label}: malformed JSON (${error instanceof Error ? error.message : String(error)})`);
        return undefined;
    }
}

function archiveEntries(path: string, command: 'tar' | 'zip', errors: string[]): string[] {
    try {
        const args = command === 'tar' ? ['-tzf', path] : ['-Z1', path];
        return execFileSync(command === 'tar' ? 'tar' : 'unzip', args, { encoding: 'utf8' })
            .split('\n')
            .map((entry) => entry.replace(/^\.\//u, '').replace(/\/$/u, ''))
            .filter(Boolean);
    } catch (error) {
        errors.push(`${command} archive is unreadable (${error instanceof Error ? error.message : String(error)})`);
        return [];
    }
}

function archiveHasPath(entries: readonly string[], required: string): boolean {
    return entries.some((entry) => entry === required || entry.endsWith(`/${required}`));
}

function validateSourceArchive(path: string, expectedRevision: string, errors: string[]): void {
    const entries = archiveEntries(path, 'tar', errors);
    if (entries.some((entry) => entry.startsWith('/') || entry.split('/').includes('..'))) {
        errors.push('source archive contains an unsafe path');
    }
    const prefix = `sourdaw-${expectedRevision}/`;
    if (!entries.some((entry) => entry.startsWith(prefix))) {
        errors.push('source archive root does not contain the candidate revision');
    }
    for (const required of SOURCE_REQUIRED_PATHS) {
        if (!entries.some((entry) => entry.startsWith(prefix) && entry.slice(prefix.length) === required)) {
            errors.push(`source archive is missing ${required}`);
        }
    }
}

function validateWebArchive(path: string, errors: string[]): void {
    const entries = archiveEntries(path, 'zip', errors);
    if (entries.some((entry) => entry.startsWith('/') || entry.split('/').includes('..'))) {
        errors.push('web archive contains an unsafe path');
    }
    for (const required of ['index.html', 'web-artifact-manifest.json']) {
        if (!archiveHasPath(entries, required)) {
            errors.push(`web archive is missing ${required}`);
        }
    }
    if (!entries.some((entry) => entry === 'assets' || entry.startsWith('assets/') || entry.includes('/assets/'))) {
        errors.push('web archive is missing assets');
    }
}

function validateSourceManifest(
    candidate: string,
    proof: JsonRecord,
    expectedRevision: string,
    errors: string[]
): void {
    const source = requiredRecord(proof, 'source', 'release proof', errors);
    if (source === undefined) return;
    const manifestPath = verifyFileHash(
        candidate,
        source.manifestPath,
        source.manifestSha256,
        'source manifest',
        errors
    );
    const archivePath = verifyFileHash(candidate, source.archivePath, source.archiveSha256, 'source archive', errors);
    if (archivePath !== undefined) validateSourceArchive(archivePath, expectedRevision, errors);
    if (manifestPath === undefined) return;
    const manifest = readJsonForValidation(manifestPath, 'source manifest', errors);
    if (manifest === undefined) return;
    if (manifest.schemaVersion !== SCHEMA_VERSION || manifest.artifact !== 'source') {
        errors.push('source manifest identity drifted');
    }
    if (manifest.sourceRevision !== expectedRevision) {
        errors.push('source manifest revision does not match candidate revision');
    }
    if (manifest.archiveSha256 !== source.archiveSha256) {
        errors.push('source manifest archive digest does not match release proof');
    }
}

function validateWebManifest(
    root: string,
    candidate: string,
    proof: JsonRecord,
    expectedRevision: string,
    errors: string[]
): void {
    const web = requiredRecord(proof, 'web', 'release proof', errors);
    if (web === undefined) return;
    const manifestPath = verifyFileHash(candidate, web.manifestPath, web.manifestSha256, 'web manifest', errors);
    const archivePath = verifyFileHash(candidate, web.archivePath, web.archiveSha256, 'web archive', errors);
    const contentsPath = candidatePath(candidate, web.contentsPath, 'web.contentsPath', errors);
    if (archivePath !== undefined) validateWebArchive(archivePath, errors);
    if (contentsPath === undefined) return;
    const manifest =
        manifestPath === undefined ? undefined : readJsonForValidation(manifestPath, 'web manifest', errors);
    if (manifest === undefined) return;
    if (manifest.schemaVersion !== SCHEMA_VERSION || manifest.artifact !== 'web') {
        errors.push('web manifest identity drifted');
    }
    if (manifest.sourceRevision !== expectedRevision) {
        errors.push('web manifest revision does not match candidate revision');
    }
    if (manifest.buildCommand !== 'pnpm build') {
        errors.push('web manifest build command drifted');
    }
    const files = stringMap(manifest.files, 'web manifest.files', errors);
    verifyFileMap(contentsPath, files, 'web contents', errors, ['web-artifact-manifest.json']);
    if (!Object.hasOwn(files, 'index.html') || !Object.keys(files).some((path) => path.startsWith('assets/'))) {
        errors.push('web contents is missing the required application entry or assets');
    }
    for (const required of WEB_REQUIRED_FILES) {
        if (!Object.hasOwn(files, required)) errors.push(`web contents is missing ${required}`);
    }
    for (const path of WEB_REQUIRED_FILES.map((value) => value.replace(/^legal\//u, 'public/legal/'))) {
        const webPath = resolve(contentsPath, ...path.replace(/^public\/legal\//u, 'legal/').split('/'));
        const sourcePath = resolve(root, ...path.split('/'));
        if (!existsSync(webPath) || !existsSync(sourcePath) || sha256File(webPath) !== sha256File(sourcePath)) {
            errors.push(`web legal file ${path} is missing or drifted`);
        }
    }
    if (archivePath !== undefined) {
        const archiveFiles = archiveEntries(archivePath, 'zip', errors).sort();
        const expectedArchiveFiles = ['web-artifact-manifest.json', ...Object.keys(files)].sort();
        if (!sameValue(archiveFiles, expectedArchiveFiles)) {
            errors.push('web archive file census does not match web contents');
        }
    }
    const contract = readJsonForValidation(resolve(root, 'release/web-artifact-manifest.json'), 'web contract', errors);
    if (
        contract !== undefined &&
        (contract.schemaVersion !== SCHEMA_VERSION ||
            contract.kind !== 'web-artifact-manifest' ||
            contract.artifact !== 'web' ||
            contract.hashAlgorithm !== 'sha256' ||
            contract.buildCommand !== 'pnpm build' ||
            contract.outputDirectory !== 'dist' ||
            contract.manifestFile !== 'web-artifact-manifest.json' ||
            contract.sourceRevisionField !== 'sourceRevision' ||
            contract.binding !== PROOF_FILE ||
            !sameValue(contract.requiredFiles, ['index.html', 'assets/', 'legal/']))
    ) {
        errors.push('web contract drifted');
    }
}

function validateDesktop(
    root: string,
    candidate: string,
    proof: JsonRecord,
    expectedRevision: string,
    errors: string[],
    runtimeContract: typeof ELECTRON_RUNTIME_CONTRACT
): void {
    const desktop = requiredRecord(proof, 'desktop', 'release proof', errors);
    if (desktop === undefined) return;
    if (desktop.platform !== 'darwin' || desktop.arch !== 'arm64') {
        errors.push('desktop proof must target darwin arm64');
    }
    const artifactPath = verifyFileHash(
        candidate,
        desktop.artifactPath,
        desktop.artifactSha256,
        'desktop artifact',
        errors
    );
    if (artifactPath !== undefined && !/mac[-_.]arm64\.(dmg|zip)$/iu.test(basename(artifactPath))) {
        errors.push('desktop artifact must be a macOS arm64 dmg or zip');
    }
    const contentsPath = candidatePath(candidate, desktop.contentsPath, 'desktop.contentsPath', errors);
    const contentsManifestPath = verifyFileHash(
        candidate,
        desktop.contentsManifestPath,
        desktop.contentsManifestSha256,
        'desktop contents manifest',
        errors
    );
    const runtimeManifestPath = verifyFileHash(
        candidate,
        desktop.runtimeManifestPath,
        desktop.runtimeManifestSha256,
        'desktop runtime manifest',
        errors
    );
    const ffmpegSourcePath = verifyFileHash(
        candidate,
        desktop.ffmpegSourcePath,
        desktop.ffmpegSourceSha256,
        'FFmpeg source material',
        errors
    );
    const ffmpegBuildPath = verifyFileHash(
        candidate,
        desktop.ffmpegBuildPath,
        desktop.ffmpegBuildSha256,
        'FFmpeg build material',
        errors
    );
    const desktopPaths = [
        desktop.artifactPath,
        desktop.contentsPath,
        desktop.contentsManifestPath,
        desktop.runtimeManifestPath,
        desktop.ffmpegSourcePath,
        desktop.ffmpegBuildPath,
    ];
    for (const pathValue of desktopPaths) {
        if (typeof pathValue === 'string' && !pathValue.startsWith('desktop/')) {
            errors.push(`desktop material is not adjacent: ${pathValue}`);
        }
    }
    if (contentsPath === undefined || contentsManifestPath === undefined) return;
    const contentsManifest = readJsonForValidation(contentsManifestPath, 'desktop contents manifest', errors);
    if (contentsManifest === undefined) return;
    if (contentsManifest.schemaVersion !== SCHEMA_VERSION || contentsManifest.artifact !== 'desktop-contents') {
        errors.push('desktop contents manifest identity drifted');
    }
    if (contentsManifest.sourceRevision !== expectedRevision) {
        errors.push('desktop contents manifest revision does not match candidate revision');
    }
    const contentsFiles = stringMap(contentsManifest.files, 'desktop contents manifest.files', errors);
    verifyFileMap(contentsPath, contentsFiles, 'desktop contents', errors);
    const requiredFiles = Array.isArray(contentsManifest.requiredFiles) ? contentsManifest.requiredFiles : [];
    for (const required of DESKTOP_REQUIRED_FILES) {
        if (!requiredFiles.includes(required) || !Object.hasOwn(contentsFiles, required)) {
            errors.push(`desktop contents is missing ${required}`);
        }
    }

    const target = runtimeContract.targets.find((item) => item.platform === 'darwin' && item.arch === 'arm64');
    const legalLicense = resolve(contentsPath, 'legal/electron-LICENSE.txt');
    const legalNotices = resolve(contentsPath, 'legal/electron-LICENSES.chromium.html');
    if (target === undefined) {
        errors.push('Electron runtime contract has no darwin/arm64 target');
    } else {
        if (!existsSync(legalLicense) || sha256File(legalLicense) !== runtimeContract.licenseSha256) {
            errors.push('desktop Electron license bytes are missing or drifted');
        }
        if (!existsSync(legalNotices) || sha256File(legalNotices) !== target.noticesSha256) {
            errors.push('desktop Electron bundled notices are missing or drifted');
        }
    }
    const sourceNotices = resolve(root, 'public/legal/THIRD-PARTY-NOTICES.md');
    const sourceRelinking = resolve(root, 'public/legal/RELINKING.md');
    for (const [name, source] of [
        ['legal/Apache-2.0.txt', resolve(root, 'public/legal/Apache-2.0.txt')],
        ['legal/DEPENDENCY-LICENSES.txt', resolve(root, 'public/legal/DEPENDENCY-LICENSES.txt')],
        ['legal/SOURDAW-NOTICE.txt', resolve(root, 'public/legal/SOURDAW-NOTICE.txt')],
        ['legal/THIRD-PARTY-NOTICES.md', sourceNotices],
        ['legal/RELINKING.md', sourceRelinking],
    ] as const) {
        const path = resolve(contentsPath, ...name.split('/'));
        if (!existsSync(path) || !existsSync(source) || sha256File(path) !== sha256File(source)) {
            errors.push(`desktop legal file ${name} is missing or drifted`);
        }
    }

    const expectedRuntime = readJsonForValidation(
        resolve(root, 'public/legal/ELECTRON-SOURCES.json'),
        'repository Electron manifest',
        errors
    );
    const actualRuntime =
        runtimeManifestPath === undefined
            ? undefined
            : readJsonForValidation(runtimeManifestPath, 'desktop runtime manifest', errors);
    if (expectedRuntime !== undefined && actualRuntime !== undefined && !sameValue(actualRuntime, expectedRuntime)) {
        errors.push('desktop runtime manifest does not match repository provenance');
    }
    if (actualRuntime !== undefined && !sameValue(actualRuntime, runtimeContract)) {
        errors.push('desktop runtime manifest does not match the pinned runtime contract');
    }
    const material = readJsonForValidation(
        resolve(root, 'release/desktop-runtime-material.json'),
        'desktop material contract',
        errors
    );
    if (material !== undefined) {
        const materialFfmpeg = isRecord(material.ffmpeg) ? material.ffmpeg : undefined;
        if (
            material.schemaVersion !== SCHEMA_VERSION ||
            material.kind !== 'desktop-runtime-material' ||
            material.artifact !== 'darwin-arm64' ||
            material.runtimeManifest !== 'ELECTRON-SOURCES.json' ||
            !sameValue(material.requiredMaterial, {
                ffmpegSource: 'ffmpeg-source.tar.gz',
                ffmpegBuild: 'ffmpeg-build.json',
            }) ||
            materialFfmpeg === undefined ||
            materialFfmpeg.repository !== runtimeContract.ffmpeg.repository ||
            materialFfmpeg.revision !== runtimeContract.ffmpeg.revision ||
            materialFfmpeg.license !== runtimeContract.ffmpeg.license ||
            !sameValue(materialFfmpeg.buildOutputs, ['libffmpeg.dylib', 'libffmpeg.so', 'ffmpeg.dll'])
        ) {
            errors.push('desktop material contract identity drifted');
        }
    }
    if (ffmpegSourcePath !== undefined && !ffmpegSourcePath.endsWith('/ffmpeg-source.tar.gz')) {
        errors.push('FFmpeg source material filename drifted');
    }
    if (ffmpegSourcePath !== undefined) {
        const entries = archiveEntries(ffmpegSourcePath, 'tar', errors);
        if (entries.length === 0 || entries.some((entry) => entry.startsWith('/') || entry.split('/').includes('..'))) {
            errors.push('FFmpeg source material is empty or unsafe');
        }
    }
    if (ffmpegBuildPath !== undefined) {
        const build = readJsonForValidation(ffmpegBuildPath, 'FFmpeg build material', errors);
        if (build !== undefined) {
            if (
                build.schemaVersion !== SCHEMA_VERSION ||
                build.artifact !== 'electron-ffmpeg-build' ||
                build.sourceRevision !== runtimeContract.ffmpeg.revision ||
                build.sourceArchiveSha256 !== desktop.ffmpegSourceSha256 ||
                build.electronVersion !== runtimeContract.version ||
                build.electronRevision !== runtimeContract.revision
            ) {
                errors.push('FFmpeg build material does not match pinned Electron/FFmpeg revisions');
            }
            if (
                !Array.isArray(build.buildInputs) ||
                build.buildInputs.length === 0 ||
                typeof build.buildCommand !== 'string'
            ) {
                errors.push('FFmpeg build material is incomplete');
            }
            const outputs = Array.isArray(build.outputs) ? [...build.outputs].sort() : [];
            if (!sameValue(outputs, [...['ffmpeg.dll', 'libffmpeg.dylib', 'libffmpeg.so']].sort())) {
                errors.push('FFmpeg build outputs are incomplete');
            }
        }
    }
    if (runtimeManifestPath !== undefined && basename(runtimeManifestPath) !== DESKTOP_MATERIAL_NAMES[0]) {
        errors.push('Electron runtime manifest filename drifted');
    }
}

export function validateReleaseProof(options: ReleaseProofOptions): string[] {
    const errors: string[] = [];
    const runtimeContract = options.runtimeContract ?? ELECTRON_RUNTIME_CONTRACT;
    if (!/^[0-9a-f]{40}$/u.test(options.expectedRevision)) {
        errors.push('expected revision must be a 40-character Git SHA');
    }
    if (!existsSync(options.candidate) || !statSync(options.candidate).isDirectory()) {
        errors.push('release proof candidate directory is missing');
        return errors;
    }
    const proofPath = resolve(options.candidate, PROOF_FILE);
    const proof = readJsonForValidation(proofPath, PROOF_FILE, errors);
    if (proof === undefined) return errors;
    if (proof.schemaVersion !== SCHEMA_VERSION) errors.push('release proof schemaVersion must be 1');
    if (proof.sourceRevision !== options.expectedRevision) {
        errors.push('release proof sourceRevision does not match the exact candidate revision');
    }
    const referencedPaths = [
        isRecord(proof.source) ? proof.source.archivePath : undefined,
        isRecord(proof.source) ? proof.source.manifestPath : undefined,
        isRecord(proof.web) ? proof.web.archivePath : undefined,
        isRecord(proof.web) ? proof.web.contentsPath : undefined,
        isRecord(proof.web) ? proof.web.manifestPath : undefined,
        isRecord(proof.desktop) ? proof.desktop.artifactPath : undefined,
        isRecord(proof.desktop) ? proof.desktop.contentsPath : undefined,
        isRecord(proof.desktop) ? proof.desktop.contentsManifestPath : undefined,
        isRecord(proof.desktop) ? proof.desktop.runtimeManifestPath : undefined,
        isRecord(proof.desktop) ? proof.desktop.ffmpegSourcePath : undefined,
        isRecord(proof.desktop) ? proof.desktop.ffmpegBuildPath : undefined,
    ].filter((value): value is string => typeof value === 'string');
    if (referencedPaths.includes(PROOF_FILE)) errors.push('release proof cannot hash or contain itself');
    if (new Set(referencedPaths).size !== referencedPaths.length) errors.push('release proof paths must be unique');
    validateSourceManifest(options.candidate, proof, options.expectedRevision, errors);
    validateWebManifest(options.root, options.candidate, proof, options.expectedRevision, errors);
    validateDesktop(options.root, options.candidate, proof, options.expectedRevision, errors, runtimeContract);
    return errors;
}

function gitRevision(root: string): string {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
}

function assertClean(root: string): void {
    const status = execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' });
    if (status.trim() !== '') throw new Error('release proof assembly requires a clean worktree');
}

function copyDirectory(source: string, destination: string): void {
    mkdirSync(destination, { recursive: true });
    cpSync(source, destination, { recursive: true, force: true, dereference: true });
}

function normalizeTreeMetadata(root: string): void {
    const files: string[] = [];
    const visit = (directory: string): void => {
        for (const entry of readdirSync(directory, { withFileTypes: true })) {
            const child = join(directory, entry.name);
            if (entry.isDirectory()) {
                chmodSync(child, 0o755);
                visit(child);
            } else if (entry.isFile()) {
                chmodSync(child, 0o644);
                files.push(child);
            }
        }
    };
    visit(root);
    const epoch = new Date('1980-01-01T00:00:00.000Z');
    for (const file of files) utimesSync(file, epoch, epoch);
}

function createDeterministicWebArchive(contents: string, archive: string): void {
    normalizeTreeMetadata(contents);
    const files = listFiles(contents, 'web contents', []).sort();
    execFileSync('zip', ['-X', '-q', archive, '-@'], {
        cwd: contents,
        input: `${files.join('\n')}\n`,
        stdio: ['pipe', 'ignore', 'pipe'],
    });
}

function fileMap(directory: string): Record<string, string> {
    const errors: string[] = [];
    const result: Record<string, string> = {};
    for (const path of listFiles(directory, 'contents', errors)) {
        if (errors.length > 0) throw new Error(errors.join('\n'));
        result[path] = sha256File(resolve(directory, ...path.split('/')));
    }
    return result;
}

function argument(args: readonly string[], name: string): string {
    const index = args.indexOf(name);
    const value = index === -1 ? undefined : args[index + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`${name} is required`);
    return value;
}

export function assembleReleaseProof(
    root: string,
    output: string,
    webDist: string,
    desktopArtifact: string,
    desktopContents: string,
    ffmpegSource: string,
    ffmpegBuild: string,
    runtimeContract: typeof ELECTRON_RUNTIME_CONTRACT = ELECTRON_RUNTIME_CONTRACT
): void {
    assertClean(root);
    const revision = gitRevision(root);
    if (existsSync(output) && readdirSync(output).length > 0) throw new Error('assembly output must be empty');
    mkdirSync(output, { recursive: true });
    const sourceDir = join(output, 'source');
    const webDir = join(output, 'web');
    const webContents = join(webDir, 'contents');
    const desktopDir = join(output, 'desktop');
    const desktopContentsOut = join(desktopDir, 'contents');
    mkdirSync(sourceDir, { recursive: true });
    mkdirSync(webContents, { recursive: true });
    mkdirSync(desktopDir, { recursive: true });
    if (!existsSync(webDist) || !statSync(webDist).isDirectory()) throw new Error('web dist directory is missing');
    if (!existsSync(desktopArtifact) || !statSync(desktopArtifact).isFile())
        throw new Error('desktop artifact is missing');
    if (!existsSync(desktopContents) || !statSync(desktopContents).isDirectory())
        throw new Error('desktop contents directory is missing');
    if (!existsSync(ffmpegSource) || !statSync(ffmpegSource).isFile())
        throw new Error('FFmpeg source material is missing');
    if (!existsSync(ffmpegBuild) || !statSync(ffmpegBuild).isFile())
        throw new Error('FFmpeg build material is missing');

    const sourceArchive = join(sourceDir, 'sourdaw-source.tar.gz');
    writeFileSync(
        sourceArchive,
        execFileSync('git', ['archive', '--format=tar.gz', `--prefix=sourdaw-${revision}/`, revision], { cwd: root })
    );
    const sourceManifest = join(sourceDir, 'source-manifest.json');
    writeJson(sourceManifest, {
        schemaVersion: SCHEMA_VERSION,
        artifact: 'source',
        sourceRevision: revision,
        archiveSha256: sha256File(sourceArchive),
    });

    copyDirectory(webDist, webContents);
    const webManifest = join(webContents, 'web-artifact-manifest.json');
    writeJson(webManifest, {
        schemaVersion: SCHEMA_VERSION,
        artifact: 'web',
        sourceRevision: revision,
        buildCommand: 'pnpm build',
        files: fileMap(webContents),
    });
    const webArchive = join(webDir, 'sourdaw-web.zip');
    createDeterministicWebArchive(webContents, webArchive);

    const desktopArtifactOut = join(desktopDir, 'Sourdaw-mac-arm64.dmg');
    cpSync(desktopArtifact, desktopArtifactOut);
    copyDirectory(desktopContents, desktopContentsOut);
    cpSync(resolve(root, 'public/legal/ELECTRON-SOURCES.json'), join(desktopDir, 'ELECTRON-SOURCES.json'));
    cpSync(ffmpegSource, join(desktopDir, 'ffmpeg-source.tar.gz'));
    cpSync(ffmpegBuild, join(desktopDir, 'ffmpeg-build.json'));
    const desktopContentsManifest = join(desktopDir, 'desktop-contents-manifest.json');
    writeJson(desktopContentsManifest, {
        schemaVersion: SCHEMA_VERSION,
        artifact: 'desktop-contents',
        sourceRevision: revision,
        requiredFiles: DESKTOP_REQUIRED_FILES,
        files: fileMap(desktopContentsOut),
    });

    const proof = {
        schemaVersion: SCHEMA_VERSION,
        sourceRevision: revision,
        source: {
            archivePath: 'source/sourdaw-source.tar.gz',
            archiveSha256: sha256File(sourceArchive),
            manifestPath: 'source/source-manifest.json',
            manifestSha256: sha256File(sourceManifest),
        },
        web: {
            archivePath: 'web/sourdaw-web.zip',
            archiveSha256: sha256File(webArchive),
            contentsPath: 'web/contents',
            manifestPath: 'web/contents/web-artifact-manifest.json',
            manifestSha256: sha256File(webManifest),
        },
        desktop: {
            platform: 'darwin',
            arch: 'arm64',
            artifactPath: 'desktop/Sourdaw-mac-arm64.dmg',
            artifactSha256: sha256File(desktopArtifactOut),
            contentsPath: 'desktop/contents',
            contentsManifestPath: 'desktop/desktop-contents-manifest.json',
            contentsManifestSha256: sha256File(desktopContentsManifest),
            runtimeManifestPath: 'desktop/ELECTRON-SOURCES.json',
            runtimeManifestSha256: sha256File(join(desktopDir, 'ELECTRON-SOURCES.json')),
            ffmpegSourcePath: 'desktop/ffmpeg-source.tar.gz',
            ffmpegSourceSha256: sha256File(join(desktopDir, 'ffmpeg-source.tar.gz')),
            ffmpegBuildPath: 'desktop/ffmpeg-build.json',
            ffmpegBuildSha256: sha256File(join(desktopDir, 'ffmpeg-build.json')),
        },
    };
    writeJson(join(output, PROOF_FILE), proof);
    const errors = validateReleaseProof({ root, candidate: output, expectedRevision: revision, runtimeContract });
    if (errors.length > 0) {
        rmSync(output, { recursive: true, force: true });
        throw new Error(errors.join('\n'));
    }
}

function main(args: readonly string[]): void {
    const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
    const mode = args[0] ?? 'check';
    if (mode === 'check') {
        const candidate = argument(args, '--candidate');
        const revision = gitRevision(root);
        const errors = validateReleaseProof({ root, candidate: resolve(candidate), expectedRevision: revision });
        if (errors.length > 0) throw new Error(errors.join('\n'));
        process.stdout.write(`release proof valid: ${revision}\n`);
        return;
    }
    if (mode === 'assemble') {
        assembleReleaseProof(
            root,
            resolve(argument(args, '--output')),
            resolve(argument(args, '--web-dist')),
            resolve(argument(args, '--desktop-artifact')),
            resolve(argument(args, '--desktop-contents')),
            resolve(argument(args, '--ffmpeg-source')),
            resolve(argument(args, '--ffmpeg-build'))
        );
        process.stdout.write(`release proof assembled: ${gitRevision(root)}\n`);
        return;
    }
    throw new Error(`unknown release-proof mode: ${mode}`);
}

const entry = process.argv[1];
if (entry !== undefined && fileURLToPath(import.meta.url) === resolve(entry)) {
    try {
        main(process.argv.slice(2));
    } catch (error) {
        process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        process.exitCode = 1;
    }
}
