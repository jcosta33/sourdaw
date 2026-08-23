#!/usr/bin/env node

import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
    chmodSync,
    closeSync,
    cpSync,
    existsSync,
    mkdirSync,
    mkdtempSync,
    openSync,
    readFileSync,
    readdirSync,
    renameSync,
    rmSync,
    statSync,
    utimesSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, extname, isAbsolute, join, posix, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ELECTRON_RUNTIME_CONTRACT, type ElectronRuntimeContract } from './electronRuntimeContract.ts';
import { parseJsonWithUniqueKeys } from './strictJson.ts';

const SCHEMA_VERSION = 1;
const PROOF_FILE = 'release-proof.json';
const DESKTOP_APP_ROOT = 'Sourdaw.app';
const DESKTOP_RESOURCE_ROOT = `${DESKTOP_APP_ROOT}/Contents/Resources`;
const DESKTOP_EXECUTABLE = `${DESKTOP_APP_ROOT}/Contents/MacOS/Sourdaw`;
const DESKTOP_FRAMEWORK_EXECUTABLE = `${DESKTOP_APP_ROOT}/Contents/Frameworks/Sourdaw Framework.framework/Versions/A/Sourdaw Framework`;
const DESKTOP_NATIVE_ADDON = `${DESKTOP_RESOURCE_ROOT}/sourdaw-native.node`;
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

export const ELECTRON_FFMPEG_BUILD_INPUTS = [
    '.github/actions/build-electron/action.yml',
    'DEPS',
    'build/args/all.gn',
    'build/args/release.gn',
    'patches/config.json',
    'patches/ffmpeg/.patches',
    'patches/ffmpeg/link_with_loader_path.patch',
] as const;

const ELECTRON_CONFIGURE_COMMAND =
    'TARGET_ARCH=arm64 e init -f --root=. --out=Default release --import release --target-cpu arm64';
const ELECTRON_BUILD_COMMAND = 'TARGET_ARCH=arm64 e build --target electron:release_build';
const ELECTRON_BUILD_TARGET = 'electron:release_build';
const FFMPEG_OUTPUT = 'src/out/Default/Electron Framework.framework/Libraries/libffmpeg.dylib';

type JsonRecord = Record<string, unknown>;

export type ReleaseProofOptions = {
    root: string;
    candidate: string;
    expectedRevision: string;
    runtimeContract?: ElectronRuntimeContract;
};

type GitIdentity = {
    tree: string;
    commitObject: Buffer;
};

export type ReleaseBuildPhase = 'web' | 'desktop';
export type ReleaseBuildRunner = (phase: ReleaseBuildPhase, root: string) => void;

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

function gitObjectId(type: 'commit', value: Buffer): string {
    return createHash('sha1').update(`${type} ${value.length}\0`).update(value).digest('hex');
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
            } else if (entry.isFile() || entry.isSymbolicLink()) {
                files.push(relative(root, child).split(sep).join('/'));
            } else {
                errors.push(`${label}: unsupported entry ${relative(root, child)}`);
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
        if (safeRelativePath(key, `${label} path`, errors) === undefined) {
            continue;
        }
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

function fileMap(directory: string): Record<string, string> {
    const errors: string[] = [];
    const result: Record<string, string> = {};
    for (const path of listFiles(directory, 'contents', errors)) {
        const absolute = resolve(directory, ...path.split('/'));
        if (!statSync(absolute).isFile()) {
            throw new Error(`contents contains unsupported link: ${path}`);
        }
        result[path] = sha256File(absolute);
    }
    if (errors.length > 0) {
        throw new Error(errors.join('\n'));
    }
    return result;
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
        const executable = command === 'tar' ? 'tar' : 'unzip';
        const args = command === 'tar' ? ['-tzf', path] : ['-Z1', path];
        return execFileSync(executable, args, {
            encoding: 'utf8',
            maxBuffer: 64 * 1024 * 1024,
            stdio: ['ignore', 'pipe', 'ignore'],
        })
            .split('\n')
            .map((entry) => entry.replace(/^\.\//u, '').replace(/\/$/u, ''))
            .filter(Boolean);
    } catch {
        errors.push(`${command} archive is unreadable`);
        return [];
    }
}

function validateArchivePaths(entries: readonly string[], label: string, errors: string[]): void {
    if (entries.length === 0) {
        errors.push(`${label} is empty`);
    }
    if (entries.some((entry) => entry.startsWith('/') || entry.includes('\\') || entry.split('/').includes('..'))) {
        errors.push(`${label} contains an unsafe path`);
    }
    if (new Set(entries).size !== entries.length) {
        errors.push(`${label} contains duplicate paths`);
    }
}

function archiveHasPath(entries: readonly string[], required: string): boolean {
    return entries.some((entry) => entry === required || entry.endsWith(`/${required}`));
}

function extractArchive(path: string, type: 'tar' | 'zip', destination: string): void {
    try {
        if (type === 'tar') {
            execFileSync('tar', ['-xzf', path, '-C', destination], { stdio: 'ignore' });
        } else {
            execFileSync('unzip', ['-qq', path, '-d', destination], { stdio: 'ignore' });
        }
    } catch {
        throw new Error(`${type} archive extraction failed`);
    }
}

function commitTree(
    commitObject: Buffer,
    expectedRevision: string,
    label: string,
    errors: string[]
): string | undefined {
    if (gitObjectId('commit', commitObject) !== expectedRevision) {
        errors.push(`${label} commit object does not match the pinned revision`);
        return undefined;
    }
    const match = /^tree ([0-9a-f]{40})$/mu.exec(commitObject.toString('utf8'));
    if (match === null) {
        errors.push(`${label} commit object has no tree`);
        return undefined;
    }
    return match[1];
}

function validateGitArchive(
    archive: string,
    commitObject: Buffer,
    expectedRevision: string,
    prefixName: string,
    requiredPaths: readonly string[],
    label: string,
    errors: string[]
): void {
    const entries = archiveEntries(archive, 'tar', errors);
    validateArchivePaths(entries, `${label} archive`, errors);
    const prefix = `${prefixName}-${expectedRevision}`;
    if (entries.some((entry) => entry !== prefix && !entry.startsWith(`${prefix}/`))) {
        errors.push(`${label} archive is not revision-rooted`);
    }
    for (const required of requiredPaths) {
        if (!entries.includes(`${prefix}/${required}`)) {
            errors.push(`${label} archive is missing ${required}`);
        }
    }
    const expectedTree = commitTree(commitObject, expectedRevision, label, errors);
    if (entries.length === 0 || expectedTree === undefined) {
        return;
    }

    const temporary = mkdtempSync(join(tmpdir(), 'sourdaw-release-tree-'));
    try {
        extractArchive(archive, 'tar', temporary);
        const sourceRoot = join(temporary, prefix);
        if (!existsSync(sourceRoot) || !statSync(sourceRoot).isDirectory()) {
            errors.push(`${label} archive root is missing`);
            return;
        }
        execFileSync('git', ['init', '--quiet'], { cwd: sourceRoot, stdio: 'ignore' });
        execFileSync('git', ['config', 'core.autocrlf', 'false'], { cwd: sourceRoot, stdio: 'ignore' });
        execFileSync('git', ['add', '-f', '--all'], { cwd: sourceRoot, stdio: 'ignore' });
        const actualTree = execFileSync('git', ['write-tree'], { cwd: sourceRoot, encoding: 'utf8' }).trim();
        if (actualTree !== expectedTree) {
            errors.push(`${label} archive contents do not match the pinned commit tree`);
        }
    } catch {
        errors.push(`${label} archive tree could not be verified`);
    } finally {
        rmSync(temporary, { recursive: true, force: true });
    }
}

function archiveFileBytes(archive: string, prefix: string, path: string): Buffer | undefined {
    try {
        return execFileSync('tar', ['-xOzf', archive, `${prefix}/${path}`], { maxBuffer: 32 * 1024 * 1024 });
    } catch {
        return undefined;
    }
}

function validateSourceManifest(
    candidate: string,
    proof: JsonRecord,
    expectedRevision: string,
    errors: string[]
): void {
    const source = requiredRecord(proof, 'source', 'release proof', errors);
    if (source === undefined) {
        return;
    }
    const manifestPath = verifyFileHash(
        candidate,
        source.manifestPath,
        source.manifestSha256,
        'source manifest',
        errors
    );
    const archivePath = verifyFileHash(candidate, source.archivePath, source.archiveSha256, 'source archive', errors);
    const commitPath = verifyFileHash(
        candidate,
        source.commitPath,
        source.commitSha256,
        'source commit object',
        errors
    );
    if (archivePath !== undefined && commitPath !== undefined) {
        validateGitArchive(
            archivePath,
            readFileSync(commitPath),
            expectedRevision,
            'sourdaw',
            SOURCE_REQUIRED_PATHS,
            'source',
            errors
        );
    }
    if (manifestPath === undefined) {
        return;
    }
    const manifest = readJsonForValidation(manifestPath, 'source manifest', errors);
    if (manifest === undefined) {
        return;
    }
    const tree =
        commitPath === undefined ? undefined : commitTree(readFileSync(commitPath), expectedRevision, 'source', errors);
    if (manifest.schemaVersion !== SCHEMA_VERSION || manifest.artifact !== 'source') {
        errors.push('source manifest identity drifted');
    }
    if (manifest.sourceRevision !== expectedRevision || manifest.commitSha1 !== expectedRevision) {
        errors.push('source manifest revision does not match candidate revision');
    }
    if (
        manifest.archiveSha256 !== source.archiveSha256 ||
        manifest.commitObjectSha256 !== source.commitSha256 ||
        (tree !== undefined && manifest.treeSha1 !== tree)
    ) {
        errors.push('source manifest provenance does not match release proof');
    }
}

function validateWebArchive(path: string, errors: string[]): void {
    const entries = archiveEntries(path, 'zip', errors);
    validateArchivePaths(entries, 'web archive', errors);
    for (const required of ['index.html', 'web-artifact-manifest.json']) {
        if (!archiveHasPath(entries, required)) {
            errors.push(`web archive is missing ${required}`);
        }
    }
    if (!entries.some((entry) => entry.startsWith('assets/') || entry.includes('/assets/'))) {
        errors.push('web archive is missing assets');
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
    if (web === undefined) {
        return;
    }
    const manifestPath = verifyFileHash(candidate, web.manifestPath, web.manifestSha256, 'web manifest', errors);
    const archivePath = verifyFileHash(candidate, web.archivePath, web.archiveSha256, 'web archive', errors);
    const contentsPath = candidatePath(candidate, web.contentsPath, 'web.contentsPath', errors);
    if (archivePath !== undefined) {
        validateWebArchive(archivePath, errors);
    }
    if (contentsPath === undefined || manifestPath === undefined) {
        return;
    }
    const manifest = readJsonForValidation(manifestPath, 'web manifest', errors);
    if (manifest === undefined) {
        return;
    }
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
        if (!Object.hasOwn(files, required)) {
            errors.push(`web contents is missing ${required}`);
        }
        const sourcePath = resolve(root, 'public', required);
        const webPath = resolve(contentsPath, ...required.split('/'));
        if (!existsSync(sourcePath) || !existsSync(webPath) || sha256File(sourcePath) !== sha256File(webPath)) {
            errors.push(`web legal file ${required} is missing or drifted`);
        }
    }
    if (archivePath !== undefined) {
        const archiveFiles = archiveEntries(archivePath, 'zip', errors).sort();
        const expectedFiles = ['web-artifact-manifest.json', ...Object.keys(files)].sort();
        if (!sameValue(archiveFiles, expectedFiles)) {
            errors.push('web archive file census does not match web contents');
        }
    }
    const contract = readJsonForValidation(resolve(root, 'release/web-artifact-manifest.json'), 'web contract', errors);
    if (
        contract !== undefined &&
        !sameValue(contract, {
            schemaVersion: 1,
            kind: 'web-artifact-manifest',
            artifact: 'web',
            hashAlgorithm: 'sha256',
            buildCommand: 'pnpm build',
            outputDirectory: 'dist',
            manifestFile: 'web-artifact-manifest.json',
            sourceRevisionField: 'sourceRevision',
            binding: PROOF_FILE,
            requiredFiles: ['index.html', 'assets/', 'legal/'],
        })
    ) {
        errors.push('web contract drifted');
    }
}

function isArm64MachO(path: string): boolean {
    if (!existsSync(path) || !statSync(path).isFile()) {
        return false;
    }
    const bytes = readFileSync(path);
    return bytes.length >= 8 && bytes.readUInt32LE(0) === 0xfeedfacf && bytes.readUInt32LE(4) === 0x0100000c;
}

function desktopSnapshot(archive: string): { files: Record<string, string>; archiveSha256: string } {
    const errors: string[] = [];
    const entries = archiveEntries(archive, 'zip', errors);
    validateArchivePaths(entries, 'desktop archive', errors);
    if (entries.some((entry) => entry !== DESKTOP_APP_ROOT && !entry.startsWith(`${DESKTOP_APP_ROOT}/`))) {
        errors.push('desktop archive must contain exactly one top-level Sourdaw.app');
    }
    const temporary = mkdtempSync(join(tmpdir(), 'sourdaw-desktop-proof-'));
    try {
        if (errors.length === 0) {
            extractArchive(archive, 'zip', temporary);
        }
        const appRoot = join(temporary, DESKTOP_APP_ROOT);
        const infoPlist = join(appRoot, 'Contents/Info.plist');
        const resources = join(appRoot, 'Contents/Resources');
        if (!existsSync(infoPlist) || !statSync(infoPlist).isFile() || !existsSync(resources)) {
            errors.push('desktop archive has an invalid macOS application layout');
        }
        if (!isArm64MachO(join(temporary, DESKTOP_EXECUTABLE))) {
            errors.push('desktop application executable is not a thin arm64 Mach-O');
        }
        if (!isArm64MachO(join(temporary, DESKTOP_FRAMEWORK_EXECUTABLE))) {
            errors.push('desktop Electron framework is not a thin arm64 Mach-O');
        }
        if (!isArm64MachO(join(temporary, DESKTOP_NATIVE_ADDON))) {
            errors.push('desktop native addon is not a thin arm64 Mach-O');
        }
        if (errors.length > 0) {
            throw new Error(errors.join('\n'));
        }
        return { files: fileMap(resources), archiveSha256: sha256File(archive) };
    } finally {
        rmSync(temporary, { recursive: true, force: true });
    }
}

function expectedDesktopMaterial(runtimeContract: ElectronRuntimeContract): JsonRecord {
    return {
        schemaVersion: 1,
        kind: 'desktop-runtime-material',
        artifact: 'darwin-arm64',
        runtimeManifest: 'ELECTRON-SOURCES.json',
        requiredMaterial: {
            electronSource: `electron-${runtimeContract.revision}.tar.gz`,
            electronCommit: `electron-${runtimeContract.revision}.commit`,
            ffmpegSource: `ffmpeg-${runtimeContract.ffmpeg.revision}.tar.gz`,
            ffmpegCommit: `ffmpeg-${runtimeContract.ffmpeg.revision}.commit`,
            ffmpegBuild: 'ffmpeg-build-material.json',
            buildInputs: 'build-inputs/electron',
        },
        electron: {
            repository: runtimeContract.repository,
            revision: runtimeContract.revision,
            buildInputs: ELECTRON_FFMPEG_BUILD_INPUTS,
        },
        ffmpeg: {
            repository: runtimeContract.ffmpeg.repository,
            revision: runtimeContract.ffmpeg.revision,
            license: runtimeContract.ffmpeg.license,
        },
        build: {
            configureCommand: ELECTRON_CONFIGURE_COMMAND,
            command: ELECTRON_BUILD_COMMAND,
            target: ELECTRON_BUILD_TARGET,
            output: FFMPEG_OUTPUT,
        },
    };
}

function validateDesktopArchiveContents(
    root: string,
    artifact: string,
    artifactSha256: unknown,
    manifest: JsonRecord,
    runtimeContract: ElectronRuntimeContract,
    errors: string[]
): void {
    let snapshot: { files: Record<string, string>; archiveSha256: string } | undefined;
    try {
        snapshot = desktopSnapshot(artifact);
    } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
        return;
    }
    if (
        manifest.schemaVersion !== SCHEMA_VERSION ||
        manifest.artifact !== 'desktop-contents' ||
        manifest.resourceRoot !== DESKTOP_RESOURCE_ROOT ||
        manifest.executablePath !== DESKTOP_EXECUTABLE ||
        manifest.frameworkExecutablePath !== DESKTOP_FRAMEWORK_EXECUTABLE ||
        manifest.nativeAddonPath !== DESKTOP_NATIVE_ADDON ||
        manifest.archiveSha256 !== artifactSha256 ||
        snapshot.archiveSha256 !== artifactSha256
    ) {
        errors.push('desktop contents manifest is not bound to the exact macOS arm64 archive');
    }
    const files = stringMap(manifest.files, 'desktop contents manifest.files', errors);
    if (!sameValue(files, snapshot.files)) {
        errors.push('desktop archive resource census or digest does not match');
    }
    for (const required of DESKTOP_REQUIRED_FILES) {
        if (!Object.hasOwn(files, required)) {
            errors.push(`desktop archive resources are missing ${required}`);
        }
    }
    for (const required of ['app.asar', 'sourdaw-native.node']) {
        if (!Object.hasOwn(files, required)) {
            errors.push(`desktop archive resources are missing ${required}`);
        }
    }

    const temporary = mkdtempSync(join(tmpdir(), 'sourdaw-desktop-legal-'));
    try {
        extractArchive(artifact, 'zip', temporary);
        const resources = join(temporary, ...DESKTOP_RESOURCE_ROOT.split('/'));
        const sourceFiles = [
            ['legal/Apache-2.0.txt', 'public/legal/Apache-2.0.txt'],
            ['legal/DEPENDENCY-LICENSES.txt', 'public/legal/DEPENDENCY-LICENSES.txt'],
            ['legal/SOURDAW-NOTICE.txt', 'public/legal/SOURDAW-NOTICE.txt'],
            ['legal/RELINKING.md', 'public/legal/RELINKING.md'],
            ['legal/THIRD-PARTY-NOTICES.md', 'public/legal/THIRD-PARTY-NOTICES.md'],
        ] as const;
        for (const [packaged, source] of sourceFiles) {
            const packagedPath = join(resources, ...packaged.split('/'));
            const sourcePath = resolve(root, ...source.split('/'));
            if (
                !existsSync(packagedPath) ||
                !existsSync(sourcePath) ||
                sha256File(packagedPath) !== sha256File(sourcePath)
            ) {
                errors.push(`desktop legal file ${packaged} is missing or drifted`);
            }
        }
        const target = runtimeContract.targets.find((item) => item.platform === 'darwin' && item.arch === 'arm64');
        const electronLicense = join(resources, 'legal/electron-LICENSE.txt');
        const electronNotices = join(resources, 'legal/electron-LICENSES.chromium.html');
        if (target === undefined) {
            errors.push('Electron runtime contract has no darwin arm64 target');
        } else {
            if (!existsSync(electronLicense) || sha256File(electronLicense) !== runtimeContract.licenseSha256) {
                errors.push('desktop Electron license bytes are missing or drifted');
            }
            if (!existsSync(electronNotices) || sha256File(electronNotices) !== target.noticesSha256) {
                errors.push('desktop Electron bundled notices are missing or drifted');
            }
        }
        const packagedRuntime = join(resources, 'legal/ELECTRON-SOURCES.json');
        if (
            !existsSync(packagedRuntime) ||
            !sameValue(readJsonForValidation(packagedRuntime, 'packaged Electron manifest', errors), runtimeContract)
        ) {
            errors.push('desktop packaged runtime manifest does not match the pinned runtime contract');
        }
    } finally {
        rmSync(temporary, { recursive: true, force: true });
    }
}

function validateBuildMaterial(
    desktop: JsonRecord,
    runtimeContract: ElectronRuntimeContract,
    paths: {
        electronArchive?: string;
        electronCommit?: string;
        ffmpegArchive?: string;
        ffmpegCommit?: string;
        buildManifest?: string;
        buildInputs?: string;
    },
    errors: string[]
): void {
    const electronTree =
        paths.electronCommit === undefined
            ? undefined
            : commitTree(readFileSync(paths.electronCommit), runtimeContract.revision, 'Electron source', errors);
    const ffmpegTree =
        paths.ffmpegCommit === undefined
            ? undefined
            : commitTree(readFileSync(paths.ffmpegCommit), runtimeContract.ffmpeg.revision, 'FFmpeg source', errors);
    if (paths.electronArchive !== undefined && paths.electronCommit !== undefined) {
        validateGitArchive(
            paths.electronArchive,
            readFileSync(paths.electronCommit),
            runtimeContract.revision,
            'electron',
            ELECTRON_FFMPEG_BUILD_INPUTS,
            'Electron source',
            errors
        );
    }
    if (paths.ffmpegArchive !== undefined && paths.ffmpegCommit !== undefined) {
        validateGitArchive(
            paths.ffmpegArchive,
            readFileSync(paths.ffmpegCommit),
            runtimeContract.ffmpeg.revision,
            'ffmpeg',
            ['BUILD.gn', 'COPYING.LGPLv2.1'],
            'FFmpeg source',
            errors
        );
    }
    if (paths.buildManifest === undefined || paths.buildInputs === undefined) {
        return;
    }
    const build = readJsonForValidation(paths.buildManifest, 'FFmpeg build material', errors);
    if (build === undefined) {
        return;
    }
    const electron = isRecord(build.electron) ? build.electron : undefined;
    const ffmpeg = isRecord(build.ffmpeg) ? build.ffmpeg : undefined;
    const commands = isRecord(build.commands) ? build.commands : undefined;
    if (
        build.schemaVersion !== SCHEMA_VERSION ||
        build.artifact !== 'electron-ffmpeg-build' ||
        build.platform !== 'darwin' ||
        build.arch !== 'arm64' ||
        electron?.repository !== runtimeContract.repository ||
        electron.revision !== runtimeContract.revision ||
        electron.treeSha1 !== electronTree ||
        electron.sourceArchiveSha256 !== desktop.electronSourceSha256 ||
        electron.commitObjectSha256 !== desktop.electronCommitSha256 ||
        ffmpeg?.repository !== runtimeContract.ffmpeg.repository ||
        ffmpeg.revision !== runtimeContract.ffmpeg.revision ||
        ffmpeg.treeSha1 !== ffmpegTree ||
        ffmpeg.sourceArchiveSha256 !== desktop.ffmpegSourceSha256 ||
        ffmpeg.commitObjectSha256 !== desktop.ffmpegCommitSha256 ||
        commands?.configure !== ELECTRON_CONFIGURE_COMMAND ||
        commands.command !== ELECTRON_BUILD_COMMAND ||
        commands.target !== ELECTRON_BUILD_TARGET ||
        commands.output !== FFMPEG_OUTPUT
    ) {
        errors.push('FFmpeg build material was not generated from the pinned Electron and FFmpeg sources');
    }
    const inputs = stringMap(build.buildInputs, 'FFmpeg build material.buildInputs', errors);
    if (!sameValue(Object.keys(inputs).sort(), [...ELECTRON_FFMPEG_BUILD_INPUTS].sort())) {
        errors.push('FFmpeg build material exact input list drifted');
    }
    verifyFileMap(paths.buildInputs, inputs, 'Electron FFmpeg build inputs', errors);
    if (paths.electronArchive !== undefined) {
        const prefix = `electron-${runtimeContract.revision}`;
        for (const path of ELECTRON_FFMPEG_BUILD_INPUTS) {
            const archived = archiveFileBytes(paths.electronArchive, prefix, path);
            const adjacent = join(paths.buildInputs, ...path.split('/'));
            if (
                archived === undefined ||
                !existsSync(adjacent) ||
                sha256Bytes(archived) !== inputs[path] ||
                sha256File(adjacent) !== inputs[path]
            ) {
                errors.push(`Electron FFmpeg build input ${path} does not match the source archive`);
            }
        }
    }
}

function validateDesktop(
    root: string,
    candidate: string,
    proof: JsonRecord,
    expectedRevision: string,
    errors: string[],
    runtimeContract: ElectronRuntimeContract
): void {
    const desktop = requiredRecord(proof, 'desktop', 'release proof', errors);
    if (desktop === undefined) {
        return;
    }
    if (desktop.platform !== 'darwin' || desktop.arch !== 'arm64') {
        errors.push('desktop proof must target darwin arm64');
    }
    const materialNames = [
        [desktop.runtimeManifestPath, 'ELECTRON-SOURCES.json'],
        [desktop.electronSourcePath, `electron-${runtimeContract.revision}.tar.gz`],
        [desktop.electronCommitPath, `electron-${runtimeContract.revision}.commit`],
        [desktop.ffmpegSourcePath, `ffmpeg-${runtimeContract.ffmpeg.revision}.tar.gz`],
        [desktop.ffmpegCommitPath, `ffmpeg-${runtimeContract.ffmpeg.revision}.commit`],
        [desktop.ffmpegBuildPath, 'ffmpeg-build-material.json'],
    ] as const;
    for (const [path, expectedName] of materialNames) {
        if (typeof path !== 'string' || basename(path) !== expectedName) {
            errors.push(`desktop material basename must be ${expectedName}`);
        }
    }
    if (desktop.buildInputsPath !== 'desktop/build-inputs/electron') {
        errors.push('desktop build input adjacency path drifted');
    }
    const artifactPath = verifyFileHash(
        candidate,
        desktop.artifactPath,
        desktop.artifactSha256,
        'desktop artifact',
        errors
    );
    if (
        artifactPath !== undefined &&
        (extname(artifactPath).toLowerCase() !== '.zip' ||
            !/^Sourdaw(?:-.+)?-mac-arm64\.zip$/u.test(basename(artifactPath)))
    ) {
        errors.push('desktop artifact must preserve its Sourdaw macOS arm64 ZIP filename');
    }
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
    const electronArchive = verifyFileHash(
        candidate,
        desktop.electronSourcePath,
        desktop.electronSourceSha256,
        'Electron source archive',
        errors
    );
    const electronCommit = verifyFileHash(
        candidate,
        desktop.electronCommitPath,
        desktop.electronCommitSha256,
        'Electron commit object',
        errors
    );
    const ffmpegArchive = verifyFileHash(
        candidate,
        desktop.ffmpegSourcePath,
        desktop.ffmpegSourceSha256,
        'FFmpeg source archive',
        errors
    );
    const ffmpegCommit = verifyFileHash(
        candidate,
        desktop.ffmpegCommitPath,
        desktop.ffmpegCommitSha256,
        'FFmpeg commit object',
        errors
    );
    const buildManifest = verifyFileHash(
        candidate,
        desktop.ffmpegBuildPath,
        desktop.ffmpegBuildSha256,
        'FFmpeg build material',
        errors
    );
    const buildInputs = candidatePath(candidate, desktop.buildInputsPath, 'desktop.buildInputsPath', errors);
    for (const value of [
        desktop.artifactPath,
        desktop.contentsManifestPath,
        desktop.runtimeManifestPath,
        desktop.electronSourcePath,
        desktop.electronCommitPath,
        desktop.ffmpegSourcePath,
        desktop.ffmpegCommitPath,
        desktop.ffmpegBuildPath,
        desktop.buildInputsPath,
    ]) {
        if (typeof value === 'string' && !value.startsWith('desktop/')) {
            errors.push(`desktop material is not adjacent: ${value}`);
        }
    }
    const manifest =
        contentsManifestPath === undefined
            ? undefined
            : readJsonForValidation(contentsManifestPath, 'desktop contents manifest', errors);
    if (manifest !== undefined) {
        if (manifest.sourceRevision !== expectedRevision) {
            errors.push('desktop contents manifest revision does not match candidate revision');
        }
        if (artifactPath !== undefined) {
            validateDesktopArchiveContents(
                root,
                artifactPath,
                desktop.artifactSha256,
                manifest,
                runtimeContract,
                errors
            );
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
    if (
        expectedRuntime !== undefined &&
        actualRuntime !== undefined &&
        (!sameValue(actualRuntime, expectedRuntime) || !sameValue(actualRuntime, runtimeContract))
    ) {
        errors.push('desktop runtime manifest does not match repository provenance');
    }
    const material = readJsonForValidation(
        resolve(root, 'release/desktop-runtime-material.json'),
        'desktop material contract',
        errors
    );
    if (material !== undefined && !sameValue(material, expectedDesktopMaterial(runtimeContract))) {
        errors.push('desktop material contract identity drifted');
    }
    validateBuildMaterial(
        desktop,
        runtimeContract,
        { electronArchive, electronCommit, ffmpegArchive, ffmpegCommit, buildManifest, buildInputs },
        errors
    );
}

function addCensusPath(value: unknown, label: string, expected: Set<string>, errors: string[]): void {
    const path = safeRelativePath(value, label, errors);
    if (path !== undefined) {
        expected.add(path);
    }
}

function validateCandidateCensus(candidate: string, proof: JsonRecord, errors: string[]): void {
    const expected = new Set<string>([PROOF_FILE]);
    const source = isRecord(proof.source) ? proof.source : undefined;
    const web = isRecord(proof.web) ? proof.web : undefined;
    const desktop = isRecord(proof.desktop) ? proof.desktop : undefined;
    for (const [value, label] of [
        [source?.archivePath, 'source.archivePath'],
        [source?.manifestPath, 'source.manifestPath'],
        [source?.commitPath, 'source.commitPath'],
        [web?.archivePath, 'web.archivePath'],
        [web?.manifestPath, 'web.manifestPath'],
        [desktop?.artifactPath, 'desktop.artifactPath'],
        [desktop?.contentsManifestPath, 'desktop.contentsManifestPath'],
        [desktop?.runtimeManifestPath, 'desktop.runtimeManifestPath'],
        [desktop?.electronSourcePath, 'desktop.electronSourcePath'],
        [desktop?.electronCommitPath, 'desktop.electronCommitPath'],
        [desktop?.ffmpegSourcePath, 'desktop.ffmpegSourcePath'],
        [desktop?.ffmpegCommitPath, 'desktop.ffmpegCommitPath'],
        [desktop?.ffmpegBuildPath, 'desktop.ffmpegBuildPath'],
    ] as const) {
        addCensusPath(value, label, expected, errors);
    }

    const webContents = safeRelativePath(web?.contentsPath, 'web.contentsPath', errors);
    const webManifest = candidatePath(candidate, web?.manifestPath, 'web.manifestPath', errors);
    if (webContents !== undefined && webManifest !== undefined && existsSync(webManifest)) {
        const manifest = readJsonForValidation(webManifest, 'web manifest census', errors);
        const files = manifest === undefined ? {} : stringMap(manifest.files, 'web manifest census.files', errors);
        for (const path of Object.keys(files)) {
            expected.add(posix.join(webContents, path));
        }
    }

    const buildInputs = safeRelativePath(desktop?.buildInputsPath, 'desktop.buildInputsPath', errors);
    const buildManifest = candidatePath(candidate, desktop?.ffmpegBuildPath, 'desktop.ffmpegBuildPath', errors);
    if (buildInputs !== undefined && buildManifest !== undefined && existsSync(buildManifest)) {
        const manifest = readJsonForValidation(buildManifest, 'FFmpeg build census', errors);
        const files =
            manifest === undefined ? {} : stringMap(manifest.buildInputs, 'FFmpeg build census.inputs', errors);
        for (const path of Object.keys(files)) {
            expected.add(posix.join(buildInputs, path));
        }
    }

    const actual = listFiles(candidate, 'release candidate', errors);
    if (!sameValue(actual, [...expected].sort())) {
        errors.push('release candidate file census contains missing or unreferenced files');
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
    const proof = readJsonForValidation(resolve(options.candidate, PROOF_FILE), PROOF_FILE, errors);
    if (proof === undefined) {
        return errors;
    }
    if (proof.schemaVersion !== SCHEMA_VERSION) {
        errors.push('release proof schemaVersion must be 1');
    }
    if (proof.sourceRevision !== options.expectedRevision) {
        errors.push('release proof sourceRevision does not match the exact candidate revision');
    }
    const referencedPaths = [
        isRecord(proof.source) ? proof.source.archivePath : undefined,
        isRecord(proof.source) ? proof.source.manifestPath : undefined,
        isRecord(proof.source) ? proof.source.commitPath : undefined,
        isRecord(proof.web) ? proof.web.archivePath : undefined,
        isRecord(proof.web) ? proof.web.contentsPath : undefined,
        isRecord(proof.web) ? proof.web.manifestPath : undefined,
        isRecord(proof.desktop) ? proof.desktop.artifactPath : undefined,
        isRecord(proof.desktop) ? proof.desktop.contentsManifestPath : undefined,
        isRecord(proof.desktop) ? proof.desktop.runtimeManifestPath : undefined,
        isRecord(proof.desktop) ? proof.desktop.electronSourcePath : undefined,
        isRecord(proof.desktop) ? proof.desktop.electronCommitPath : undefined,
        isRecord(proof.desktop) ? proof.desktop.ffmpegSourcePath : undefined,
        isRecord(proof.desktop) ? proof.desktop.ffmpegCommitPath : undefined,
        isRecord(proof.desktop) ? proof.desktop.ffmpegBuildPath : undefined,
        isRecord(proof.desktop) ? proof.desktop.buildInputsPath : undefined,
    ].filter((value): value is string => typeof value === 'string');
    if (referencedPaths.includes(PROOF_FILE)) {
        errors.push('release proof cannot hash or contain itself');
    }
    if (new Set(referencedPaths).size !== referencedPaths.length) {
        errors.push('release proof paths must be unique');
    }
    validateSourceManifest(options.candidate, proof, options.expectedRevision, errors);
    validateWebManifest(options.root, options.candidate, proof, options.expectedRevision, errors);
    validateDesktop(options.root, options.candidate, proof, options.expectedRevision, errors, runtimeContract);
    validateCandidateCensus(options.candidate, proof, errors);
    return errors;
}

function gitRevision(root: string): string {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
}

function assertClean(root: string): void {
    const status = execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' });
    if (status.trim() !== '') {
        throw new Error('release proof assembly requires a clean worktree');
    }
}

function normalizedRepository(value: string): string {
    return value
        .trim()
        .replace(/^git@github\.com:/u, 'github.com/')
        .replace(/^ssh:\/\/git@github\.com\//u, 'github.com/')
        .replace(/^https:\/\/github\.com\//u, 'github.com/')
        .replace(/\.git$/u, '')
        .replace(/\/$/u, '');
}

function verifyGitCheckout(checkout: string, repository: string, revision: string, label: string): GitIdentity {
    if (!existsSync(checkout) || !statSync(checkout).isDirectory()) {
        throw new Error(`${label} Git checkout is missing`);
    }
    let head: string;
    let remote: string;
    let tree: string;
    let commitObject: Buffer;
    try {
        head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: checkout, encoding: 'utf8' }).trim();
        remote = execFileSync('git', ['remote', 'get-url', 'origin'], { cwd: checkout, encoding: 'utf8' }).trim();
        tree = execFileSync('git', ['rev-parse', `${revision}^{tree}`], { cwd: checkout, encoding: 'utf8' }).trim();
        commitObject = execFileSync('git', ['cat-file', 'commit', revision], { cwd: checkout });
    } catch {
        throw new Error(`${label} Git checkout identity could not be verified`);
    }
    if (head !== revision) {
        throw new Error(`${label} checkout HEAD does not match the pinned revision`);
    }
    if (normalizedRepository(remote) !== normalizedRepository(repository)) {
        throw new Error(`${label} checkout origin does not match the pinned repository`);
    }
    if (gitObjectId('commit', commitObject) !== revision) {
        throw new Error(`${label} commit object is invalid`);
    }
    return { tree, commitObject };
}

function createGitArchive(checkout: string, revision: string, prefix: string, output: string): void {
    const descriptor = openSync(output, 'w');
    try {
        const result = spawnSync('git', ['archive', '--format=tar.gz', `--prefix=${prefix}-${revision}/`, revision], {
            cwd: checkout,
            stdio: ['ignore', descriptor, 'pipe'],
        });
        if (result.status !== 0) {
            throw new Error('Git source archive generation failed');
        }
    } finally {
        closeSync(descriptor);
    }
}

function gitFile(checkout: string, revision: string, path: string): Buffer {
    try {
        return execFileSync('git', ['show', `${revision}:${path}`], { cwd: checkout, maxBuffer: 32 * 1024 * 1024 });
    } catch {
        throw new Error(`pinned Electron source is missing build input ${path}`);
    }
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
    for (const file of files) {
        utimesSync(file, epoch, epoch);
    }
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

function argument(args: readonly string[], name: string): string {
    const index = args.indexOf(name);
    const value = index === -1 ? undefined : args[index + 1];
    if (value === undefined || value.startsWith('--')) {
        throw new Error(`${name} is required`);
    }
    return value;
}

function assertBuildState(root: string, revision: string): void {
    if (gitRevision(root) !== revision) {
        throw new Error('release build changed the candidate Git revision');
    }
    const status = execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], {
        cwd: root,
        encoding: 'utf8',
    });
    if (status.trim() !== '') {
        throw new Error('release build changed tracked source files');
    }
}

function removeIgnoredOutput(root: string, path: string): void {
    const ignorePath = extname(path) === '' ? `${path}/` : path;
    const ignored = spawnSync('git', ['check-ignore', '--no-index', '--quiet', '--', ignorePath], { cwd: root });
    if (ignored.status !== 0) {
        throw new Error(`refusing to clear non-ignored build output ${path}`);
    }
    rmSync(resolve(root, ...path.split('/')), { recursive: true, force: true });
}

function clearWebBuildOutputs(root: string): void {
    removeIgnoredOutput(root, 'dist');
}

function clearDesktopBuildOutputs(root: string): void {
    for (const path of ['dist', 'electron/out', 'release/desktop']) {
        removeIgnoredOutput(root, path);
    }
    const nativeRoot = resolve(root, 'crates/sourdaw-native');
    if (!existsSync(nativeRoot)) {
        return;
    }
    for (const entry of readdirSync(nativeRoot, { withFileTypes: true })) {
        if (entry.isFile() && /\.(?:dylib|node)$/u.test(entry.name)) {
            removeIgnoredOutput(root, `crates/sourdaw-native/${entry.name}`);
        }
    }
}

function runProjectBuild(phase: ReleaseBuildPhase, root: string): void {
    execFileSync('pnpm', [phase === 'web' ? 'build' : 'desktop:build'], { cwd: root, stdio: 'inherit' });
}

function selectDesktopArtifact(root: string): string {
    const directory = resolve(root, 'release/desktop');
    if (!existsSync(directory) || !statSync(directory).isDirectory()) {
        throw new Error('desktop build produced no release directory');
    }
    const zipFiles = readdirSync(directory, { withFileTypes: true })
        .filter((entry) => entry.isFile() && extname(entry.name).toLowerCase() === '.zip')
        .map((entry) => entry.name)
        .sort();
    if (zipFiles.length !== 1) {
        throw new Error('desktop build must produce exactly one new ZIP artifact');
    }
    const artifactName = zipFiles[0];
    if (artifactName === undefined) {
        throw new Error('desktop build must produce exactly one new ZIP artifact');
    }
    if (!/^Sourdaw(?:-.+)?-mac-arm64\.zip$/u.test(artifactName)) {
        throw new Error('desktop build produced a ZIP with the wrong macOS arm64 identity');
    }
    return join(directory, artifactName);
}

export function assembleReleaseProof(
    root: string,
    output: string,
    electronSource: string,
    ffmpegSource: string,
    runtimeContract: ElectronRuntimeContract = ELECTRON_RUNTIME_CONTRACT,
    buildRunner: ReleaseBuildRunner = runProjectBuild
): void {
    assertClean(root);
    const revision = gitRevision(root);
    const sourceIdentity = verifyGitCheckout(
        root,
        execFileSync('git', ['remote', 'get-url', 'origin'], { cwd: root, encoding: 'utf8' }).trim(),
        revision,
        'Sourdaw'
    );
    const electronIdentity = verifyGitCheckout(
        electronSource,
        runtimeContract.repository,
        runtimeContract.revision,
        'Electron source'
    );
    const ffmpegIdentity = verifyGitCheckout(
        ffmpegSource,
        runtimeContract.ffmpeg.repository,
        runtimeContract.ffmpeg.revision,
        'FFmpeg source'
    );
    if (existsSync(output)) {
        throw new Error('assembly output must not already exist');
    }
    mkdirSync(dirname(output), { recursive: true });
    const candidate = mkdtempSync(join(dirname(output), `.${basename(output)}.tmp-`));
    try {
        const sourceDir = join(candidate, 'source');
        const webDir = join(candidate, 'web');
        const webContents = join(webDir, 'contents');
        const desktopDir = join(candidate, 'desktop');
        const buildInputsDir = join(desktopDir, 'build-inputs/electron');
        mkdirSync(sourceDir, { recursive: true });
        mkdirSync(webContents, { recursive: true });
        mkdirSync(buildInputsDir, { recursive: true });

        clearWebBuildOutputs(root);
        buildRunner('web', root);
        assertBuildState(root, revision);
        const webDist = resolve(root, 'dist');
        if (!existsSync(webDist) || !statSync(webDist).isDirectory()) {
            throw new Error('web build produced no dist directory');
        }
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

        clearDesktopBuildOutputs(root);
        buildRunner('desktop', root);
        assertBuildState(root, revision);
        const desktopArtifact = selectDesktopArtifact(root);
        const artifactName = basename(desktopArtifact);
        const desktopArtifactOut = join(desktopDir, artifactName);
        cpSync(desktopArtifact, desktopArtifactOut);
        const desktop = desktopSnapshot(desktopArtifactOut);
        const runtimeManifest = join(desktopDir, 'ELECTRON-SOURCES.json');
        cpSync(resolve(root, 'public/legal/ELECTRON-SOURCES.json'), runtimeManifest);
        const contentsManifest = join(desktopDir, 'desktop-contents-manifest.json');
        writeJson(contentsManifest, {
            schemaVersion: SCHEMA_VERSION,
            artifact: 'desktop-contents',
            sourceRevision: revision,
            archiveSha256: desktop.archiveSha256,
            resourceRoot: DESKTOP_RESOURCE_ROOT,
            executablePath: DESKTOP_EXECUTABLE,
            frameworkExecutablePath: DESKTOP_FRAMEWORK_EXECUTABLE,
            nativeAddonPath: DESKTOP_NATIVE_ADDON,
            files: desktop.files,
        });

        const sourceArchive = join(sourceDir, `sourdaw-${revision}.tar.gz`);
        const sourceCommit = join(sourceDir, `sourdaw-${revision}.commit`);
        createGitArchive(root, revision, 'sourdaw', sourceArchive);
        writeFileSync(sourceCommit, sourceIdentity.commitObject);
        const sourceManifest = join(sourceDir, 'source-manifest.json');
        writeJson(sourceManifest, {
            schemaVersion: SCHEMA_VERSION,
            artifact: 'source',
            sourceRevision: revision,
            commitSha1: revision,
            treeSha1: sourceIdentity.tree,
            archiveSha256: sha256File(sourceArchive),
            commitObjectSha256: sha256File(sourceCommit),
        });

        const electronArchive = join(desktopDir, `electron-${runtimeContract.revision}.tar.gz`);
        const electronCommit = join(desktopDir, `electron-${runtimeContract.revision}.commit`);
        const ffmpegArchive = join(desktopDir, `ffmpeg-${runtimeContract.ffmpeg.revision}.tar.gz`);
        const ffmpegCommit = join(desktopDir, `ffmpeg-${runtimeContract.ffmpeg.revision}.commit`);
        createGitArchive(electronSource, runtimeContract.revision, 'electron', electronArchive);
        createGitArchive(ffmpegSource, runtimeContract.ffmpeg.revision, 'ffmpeg', ffmpegArchive);
        writeFileSync(electronCommit, electronIdentity.commitObject);
        writeFileSync(ffmpegCommit, ffmpegIdentity.commitObject);
        for (const path of ELECTRON_FFMPEG_BUILD_INPUTS) {
            const destination = join(buildInputsDir, ...path.split('/'));
            mkdirSync(dirname(destination), { recursive: true });
            writeFileSync(destination, gitFile(electronSource, runtimeContract.revision, path));
        }
        const buildManifest = join(desktopDir, 'ffmpeg-build-material.json');
        writeJson(buildManifest, {
            schemaVersion: SCHEMA_VERSION,
            artifact: 'electron-ffmpeg-build',
            platform: 'darwin',
            arch: 'arm64',
            electron: {
                repository: runtimeContract.repository,
                revision: runtimeContract.revision,
                treeSha1: electronIdentity.tree,
                sourceArchiveSha256: sha256File(electronArchive),
                commitObjectSha256: sha256File(electronCommit),
            },
            ffmpeg: {
                repository: runtimeContract.ffmpeg.repository,
                revision: runtimeContract.ffmpeg.revision,
                treeSha1: ffmpegIdentity.tree,
                sourceArchiveSha256: sha256File(ffmpegArchive),
                commitObjectSha256: sha256File(ffmpegCommit),
            },
            buildInputs: fileMap(buildInputsDir),
            commands: {
                configure: ELECTRON_CONFIGURE_COMMAND,
                command: ELECTRON_BUILD_COMMAND,
                target: ELECTRON_BUILD_TARGET,
                output: FFMPEG_OUTPUT,
            },
        });

        const proof = {
            schemaVersion: SCHEMA_VERSION,
            sourceRevision: revision,
            source: {
                archivePath: `source/sourdaw-${revision}.tar.gz`,
                archiveSha256: sha256File(sourceArchive),
                commitPath: `source/sourdaw-${revision}.commit`,
                commitSha256: sha256File(sourceCommit),
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
                artifactPath: `desktop/${artifactName}`,
                artifactSha256: sha256File(desktopArtifactOut),
                contentsManifestPath: 'desktop/desktop-contents-manifest.json',
                contentsManifestSha256: sha256File(contentsManifest),
                runtimeManifestPath: 'desktop/ELECTRON-SOURCES.json',
                runtimeManifestSha256: sha256File(runtimeManifest),
                electronSourcePath: `desktop/electron-${runtimeContract.revision}.tar.gz`,
                electronSourceSha256: sha256File(electronArchive),
                electronCommitPath: `desktop/electron-${runtimeContract.revision}.commit`,
                electronCommitSha256: sha256File(electronCommit),
                ffmpegSourcePath: `desktop/ffmpeg-${runtimeContract.ffmpeg.revision}.tar.gz`,
                ffmpegSourceSha256: sha256File(ffmpegArchive),
                ffmpegCommitPath: `desktop/ffmpeg-${runtimeContract.ffmpeg.revision}.commit`,
                ffmpegCommitSha256: sha256File(ffmpegCommit),
                ffmpegBuildPath: 'desktop/ffmpeg-build-material.json',
                ffmpegBuildSha256: sha256File(buildManifest),
                buildInputsPath: 'desktop/build-inputs/electron',
            },
        };
        writeJson(join(candidate, PROOF_FILE), proof);
        const errors = validateReleaseProof({ root, candidate, expectedRevision: revision, runtimeContract });
        if (errors.length > 0) {
            throw new Error(errors.join('\n'));
        }
        assertBuildState(root, revision);
        renameSync(candidate, output);
    } catch (error) {
        rmSync(candidate, { recursive: true, force: true });
        throw error;
    }
}

function main(args: readonly string[]): void {
    const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
    const mode = args[0] ?? 'check';
    if (mode === 'check') {
        const candidate = argument(args, '--candidate');
        const revision = gitRevision(root);
        const errors = validateReleaseProof({ root, candidate: resolve(candidate), expectedRevision: revision });
        if (errors.length > 0) {
            throw new Error(errors.join('\n'));
        }
        process.stdout.write(`release proof valid: ${revision}\n`);
        return;
    }
    if (mode === 'assemble') {
        assembleReleaseProof(
            root,
            resolve(argument(args, '--output')),
            resolve(argument(args, '--electron-source')),
            resolve(argument(args, '--ffmpeg-source'))
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
