#!/usr/bin/env node

import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
    chmodSync,
    closeSync,
    constants,
    cpSync,
    existsSync,
    fstatSync,
    lstatSync,
    mkdirSync,
    mkdtempSync,
    openSync,
    readSync,
    readdirSync,
    realpathSync,
    renameSync,
    rmSync,
    statSync,
    symlinkSync,
    utimesSync,
    writeFileSync,
    writeSync,
} from 'node:fs';
import { devNull, tmpdir } from 'node:os';
import { basename, dirname, extname, isAbsolute, join, posix, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { extractFile, listPackage, statFile } from '@electron/asar';
import { FuseV1Options, type FuseState } from '@electron/fuses';
import { Unzip, UnzipInflate } from 'fflate';
import { Parser as TarParser } from 'tar';

import { checkReleaseInventory, readReleaseInventory, type ReleaseInventory } from './checkReleaseInventory.ts';
import { ELECTRON_RUNTIME_CONTRACT, type ElectronRuntimeContract } from './electronRuntimeContract.ts';
import { findFuseMismatches, REQUIRED_FUSES } from './flipElectronFuses.ts';
import { parseJsonWithUniqueKeys } from './strictJson.ts';

const SCHEMA_VERSION = 1;
const PROOF_FILE = 'release-proof.json';
const DESKTOP_APP_ROOT = 'Sourdaw.app';
const DESKTOP_RESOURCE_ROOT = `${DESKTOP_APP_ROOT}/Contents/Resources`;
const DESKTOP_EXECUTABLE = `${DESKTOP_APP_ROOT}/Contents/MacOS/Sourdaw`;
const DESKTOP_FRAMEWORK_EXECUTABLE = `${DESKTOP_APP_ROOT}/Contents/Frameworks/Sourdaw Framework.framework/Versions/A/Sourdaw Framework`;
const DESKTOP_FFMPEG = `${DESKTOP_APP_ROOT}/Contents/Frameworks/Sourdaw Framework.framework/Versions/A/Libraries/libffmpeg.dylib`;
const DESKTOP_NATIVE_ADDON = `${DESKTOP_RESOURCE_ROOT}/sourdaw-native.node`;
const DESKTOP_ASAR = `${DESKTOP_RESOURCE_ROOT}/app.asar`;
const ELECTRON_RUNTIME_FFMPEG =
    'node_modules/electron/dist/Electron.app/Contents/Frameworks/Electron Framework.framework/Versions/A/Libraries/libffmpeg.dylib';
const FUSE_SENTINEL = Buffer.from('dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX');
const MACH_HEADER_64_SIZE = 32;
const CPU_TYPE_ARM64 = 0x0100000c;
const MH_EXECUTE = 0x2;
const MH_DYLIB = 0x6;
const MH_BUNDLE = 0x8;
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
const WEBLLM_SURFACE_ID = 'webllm-qwen-artifacts';
const PUBLIC_LEGAL_PREFIX = 'public/legal/';
const PACKAGED_LEGAL_PREFIX = 'legal/';

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
const HASH_CHUNK_BYTES = 1024 * 1024;

export const RELEASE_PROOF_TYPE_LIMITS = {
    jsonBytes: 8 * 1024 * 1024,
    commitObjectBytes: 1024 * 1024,
    machLoadCommandBytes: 16 * 1024 * 1024,
    fuseWireBytes: 64 * 1024,
    asarHeaderBytes: 16 * 1024 * 1024,
    asarRendererEntryBytes: 64 * 1024 * 1024,
    buildInputBytes: 4 * 1024 * 1024,
} as const;

export const RELEASE_PROOF_ARCHIVE_LIMITS = {
    entries: 60_000,
    pathDepth: 64,
    entryBytes: 512 * 1024 * 1024,
    expandedBytes: 4 * 1024 * 1024 * 1024,
    candidateFileBytes: 4 * 1024 * 1024 * 1024,
} as const;

type JsonRecord = Record<string, unknown>;

class FileReadLimitError extends Error {
    constructor(readonly kind: 'file' | 'aggregate') {
        super();
    }
}

export type ReleaseProofOptions = {
    root: string;
    candidate: string;
    expectedRevision: string;
    runtimeContract?: ElectronRuntimeContract;
    releaseInventory?: ReleaseInventory;
    releaseInventoryReader?: ReleaseInventoryReader;
    fileReader?: ReleaseProofFileReader;
};

type GitIdentity = {
    tree: string;
    commitObject: Buffer;
};

export type ReleaseBuildPhase = 'web' | 'desktop';
export type ReleaseBuildRunner = (phase: ReleaseBuildPhase, root: string) => void;
export type ReleaseGateRunner = (root: string, releaseInventory?: ReleaseInventory) => void;
export type ReleaseInventoryReader = (root: string) => ReleaseInventory;
export type ReleaseProofValidator = (options: ReleaseProofOptions) => string[];
export type ReleaseProofFileReader = {
    open?: (path: string, flags: number) => number;
    noFollowFlag?: () => unknown;
    read?: (descriptor: number, buffer: Buffer, offset: number, length: number, position: number) => number;
    snapshotByteLimit?: number;
};

type VerifiedCandidateFile = {
    candidatePath: string;
    digest: string;
    snapshotPath: string;
};

type CandidateSnapshotBudget = {
    limit: number;
    remaining: number;
};

type CandidateCensusMaps = {
    buildInputs?: Record<string, string>;
    webFiles?: Record<string, string>;
};

const releaseProofFileReader: ReleaseProofFileReader = {
    open: (path, flags) => openSync(path, flags),
    noFollowFlag: () => Reflect.get(constants, 'O_NOFOLLOW'),
    read: (descriptor, buffer, offset, length, position) => readSync(descriptor, buffer, offset, length, position),
};

function candidateSnapshotBudget(fileReader: ReleaseProofFileReader): CandidateSnapshotBudget {
    const requested = fileReader.snapshotByteLimit;
    const limit =
        requested === undefined || !Number.isSafeInteger(requested)
            ? RELEASE_PROOF_ARCHIVE_LIMITS.expandedBytes
            : Math.max(0, Math.min(requested, RELEASE_PROOF_ARCHIVE_LIMITS.expandedBytes));
    return { limit, remaining: limit };
}

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
    const descriptor = openSync(path, 'r');
    try {
        const hash = createHash('sha256');
        const chunk = Buffer.alloc(HASH_CHUNK_BYTES);
        let position = 0;
        let bytesRead: number;
        do {
            bytesRead = readSync(descriptor, chunk, 0, chunk.length, position);
            if (bytesRead > 0) {
                hash.update(chunk.subarray(0, bytesRead));
                position += bytesRead;
            }
        } while (bytesRead > 0);
        return hash.digest('hex');
    } finally {
        closeSync(descriptor);
    }
}

function withContainedRegularFile<Result>(
    root: string,
    path: string,
    maxBytes: number,
    consume: (descriptor: number) => Result,
    fileReader: ReleaseProofFileReader = releaseProofFileReader
): Result | undefined {
    let descriptor: number | undefined;
    try {
        const noFollowFlag = fileReader.noFollowFlag?.();
        if (typeof noFollowFlag !== 'number' || noFollowFlag === 0) {
            return undefined;
        }
        const rootRealPath = realpathSync(root);
        const beforeOpen = lstatSync(path);
        if (!beforeOpen.isFile()) {
            return undefined;
        }
        descriptor = (fileReader.open ?? openSync)(path, constants.O_RDONLY | noFollowFlag);
        const opened = fstatSync(descriptor);
        if (opened.size > maxBytes) {
            throw new FileReadLimitError('file');
        }
        const afterOpen = lstatSync(path);
        const realPath = realpathSync(path);
        const resolved = statSync(realPath);
        if (
            !opened.isFile() ||
            !afterOpen.isFile() ||
            !isContained(rootRealPath, realPath) ||
            opened.dev !== beforeOpen.dev ||
            opened.ino !== beforeOpen.ino ||
            opened.dev !== afterOpen.dev ||
            opened.ino !== afterOpen.ino ||
            opened.dev !== resolved.dev ||
            opened.ino !== resolved.ino
        ) {
            return undefined;
        }
        return consume(descriptor);
    } catch (error) {
        if (error instanceof FileReadLimitError) {
            throw error;
        }
        return undefined;
    } finally {
        if (descriptor !== undefined) {
            closeSync(descriptor);
        }
    }
}

function sha256ContainedRegularFile(
    root: string,
    path: string,
    maxBytes = RELEASE_PROOF_ARCHIVE_LIMITS.candidateFileBytes,
    fileReader: ReleaseProofFileReader = releaseProofFileReader
): string | undefined {
    return withContainedRegularFile(
        root,
        path,
        maxBytes,
        (descriptor) => {
            const hash = createHash('sha256');
            const chunk = Buffer.alloc(HASH_CHUNK_BYTES);
            let position = 0;
            let bytesRead: number;
            do {
                bytesRead = (fileReader.read ?? readSync)(descriptor, chunk, 0, chunk.length, position);
                if (bytesRead > 0) {
                    hash.update(chunk.subarray(0, bytesRead));
                    position += bytesRead;
                }
            } while (bytesRead > 0);
            return hash.digest('hex');
        },
        fileReader
    );
}

function snapshotCandidateFile(
    root: string,
    path: string,
    snapshotRoot: string,
    maxBytes: number,
    budget: CandidateSnapshotBudget,
    fileReader: ReleaseProofFileReader
): { digest: string; snapshotPath: string } | undefined {
    const snapshotPath = join(snapshotRoot, `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`);
    return withContainedRegularFile(
        root,
        path,
        maxBytes,
        (descriptor) => {
            let observedSize = fstatSync(descriptor).size;
            if (observedSize > budget.remaining) {
                throw new FileReadLimitError('aggregate');
            }
            const output = openSync(snapshotPath, 'wx');
            try {
                const hash = createHash('sha256');
                const chunk = Buffer.alloc(HASH_CHUNK_BYTES);
                let position = 0;
                while (true) {
                    if (position >= observedSize) {
                        observedSize = fstatSync(descriptor).size;
                        if (observedSize > maxBytes) {
                            throw new FileReadLimitError('file');
                        }
                        if (observedSize - position > budget.remaining) {
                            throw new FileReadLimitError('aggregate');
                        }
                        if (position >= observedSize) {
                            return { digest: hash.digest('hex'), snapshotPath };
                        }
                    }
                    const readLength = Math.min(
                        chunk.length,
                        observedSize - position,
                        maxBytes - position,
                        budget.remaining
                    );
                    const bytesRead = (fileReader.read ?? readSync)(descriptor, chunk, 0, readLength, position);
                    if (!Number.isInteger(bytesRead) || bytesRead < 0 || bytesRead > readLength) {
                        throw new FileReadLimitError('file');
                    }
                    if (bytesRead === 0) {
                        return { digest: hash.digest('hex'), snapshotPath };
                    }
                    const bytes = chunk.subarray(0, bytesRead);
                    hash.update(bytes);
                    writeSync(output, bytes);
                    position += bytesRead;
                    budget.remaining -= bytesRead;
                }
            } finally {
                closeSync(output);
            }
        },
        fileReader
    );
}

function gitObjectId(type: 'commit', value: Buffer): string {
    return createHash('sha1').update(`${type} ${value.length}\0`).update(value).digest('hex');
}

function writeJson(path: string, value: unknown): void {
    writeFileSync(path, `${JSON.stringify(value, null, 4)}\n`);
}

function readBoundedFile(
    root: string,
    path: string,
    maxBytes: number,
    label: string,
    fileReader: ReleaseProofFileReader = releaseProofFileReader
): Buffer {
    let value: Buffer | undefined;
    try {
        value = withContainedRegularFile(
            root,
            path,
            maxBytes,
            (descriptor) => {
                const size = fstatSync(descriptor).size;
                const contents = Buffer.alloc(size);
                let offset = 0;
                while (offset < contents.length) {
                    const bytesRead = (fileReader.read ?? readSync)(
                        descriptor,
                        contents,
                        offset,
                        contents.length - offset,
                        offset
                    );
                    if (bytesRead === 0) {
                        throw new Error(`${label} changed while reading`);
                    }
                    offset += bytesRead;
                }
                return contents;
            },
            fileReader
        );
    } catch (error) {
        if (error instanceof FileReadLimitError) {
            throw new TypeError(`${label} exceeds the ${String(maxBytes)}-byte read limit`, { cause: error });
        }
        throw error;
    }
    if (value === undefined) {
        throw new Error(`${label} cannot be read safely within the ${String(maxBytes)}-byte read limit`);
    }
    return value;
}

function readJson(root: string, path: string): unknown {
    return parseJsonWithUniqueKeys(
        readBoundedFile(root, path, RELEASE_PROOF_TYPE_LIMITS.jsonBytes, 'JSON document').toString('utf8'),
        path
    );
}

function readCommitObject(root: string, path: string, label: string, errors: string[]): Buffer | undefined {
    try {
        return readBoundedFile(root, path, RELEASE_PROOF_TYPE_LIMITS.commitObjectBytes, `${label} commit object`);
    } catch (error) {
        errors.push(error instanceof Error ? error.message : `${label} commit object cannot be read`);
        return undefined;
    }
}

function expectedDesktopArtifactName(root: string): string {
    const value = readJson(root, resolve(root, 'package.json'));
    const version = isRecord(value) ? value.version : undefined;
    if (typeof version !== 'string' || !/^[0-9A-Za-z][0-9A-Za-z.+-]*$/u.test(version)) {
        throw new Error('project package version cannot identify the desktop artifact');
    }
    return `Sourdaw-${version}-arm64-mac.zip`;
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

function isContained(root: string, path: string): boolean {
    const fromRoot = relative(root, path);
    return fromRoot === '' || (!fromRoot.startsWith(`..${sep}`) && fromRoot !== '..' && !isAbsolute(fromRoot));
}

function containedRealPath(root: string, path: string, label: string, errors: string[]): string | undefined {
    try {
        const realRoot = realpathSync(root);
        const realPath = realpathSync(path);
        if (!isContained(realRoot, realPath)) {
            errors.push(`${label}: path escapes its containing directory`);
            return undefined;
        }
        return realPath;
    } catch {
        errors.push(`${label}: path cannot be resolved`);
        return undefined;
    }
}

function verifyFileHash(
    root: string,
    pathValue: unknown,
    hashValue: unknown,
    label: string,
    maxBytes: number,
    errors: string[],
    snapshotRoot: string,
    budget: CandidateSnapshotBudget,
    fileReader: ReleaseProofFileReader
): VerifiedCandidateFile | undefined {
    const path = candidatePath(root, pathValue, `${label}.path`, errors);
    const hash = typeof hashValue === 'string' && /^[0-9a-f]{64}$/u.test(hashValue) ? hashValue : undefined;
    if (hash === undefined) {
        errors.push(`${label}.sha256 must be a lowercase SHA-256 digest`);
    }
    if (path === undefined || hash === undefined) {
        return undefined;
    }
    if (!existsSync(path)) {
        errors.push(`${label}: file is missing`);
        return undefined;
    }
    let snapshot: { digest: string; snapshotPath: string } | undefined;
    try {
        snapshot = snapshotCandidateFile(root, path, snapshotRoot, maxBytes, budget, fileReader);
    } catch (error) {
        if (error instanceof FileReadLimitError) {
            errors.push(
                error.kind === 'aggregate'
                    ? `${label}: cumulative candidate snapshot byte limit exceeded (${String(budget.limit)} bytes)`
                    : `${label}: file exceeds the candidate file-size limit`
            );
            return undefined;
        }
        throw error;
    }
    if (snapshot === undefined) {
        errors.push(`${label}: file is missing or unsafe`);
        return undefined;
    }
    if (snapshot.digest !== hash) {
        errors.push(`${label}: digest mismatch`);
    }
    return { candidatePath: path, digest: snapshot.digest, snapshotPath: snapshot.snapshotPath };
}

function listFiles(root: string, label: string, errors: string[], allowContainedLinks = false): string[] {
    if (!existsSync(root) || !lstatSync(root).isDirectory()) {
        errors.push(`${label}: directory is missing`);
        return [];
    }
    const files: string[] = [];
    const directories = [root];
    let entryCount = 0;
    let aggregateBytes = 0;
    while (directories.length > 0) {
        const directory = directories.pop();
        if (directory === undefined) {
            break;
        }
        for (const entry of readdirSync(directory, { withFileTypes: true })) {
            const child = join(directory, entry.name);
            const childPath = relative(root, child).split(sep).join('/');
            entryCount += 1;
            if (entryCount > RELEASE_PROOF_ARCHIVE_LIMITS.entries) {
                errors.push(`${label}: traversal exceeds the entry count limit`);
                return files.sort();
            }
            if (childPath.split('/').length > RELEASE_PROOF_ARCHIVE_LIMITS.pathDepth) {
                errors.push(`${label}: traversal contains a path exceeding the depth limit (${childPath})`);
                continue;
            }
            const metadata = lstatSync(child);
            if (metadata.isSymbolicLink()) {
                if (!allowContainedLinks) {
                    errors.push(`${label}: symbolic links are forbidden (${childPath})`);
                } else {
                    containedRealPath(root, child, `${label} symbolic link ${childPath}`, errors);
                }
            } else if (metadata.isDirectory()) {
                directories.push(child);
            } else if (metadata.isFile()) {
                if (metadata.size > RELEASE_PROOF_ARCHIVE_LIMITS.candidateFileBytes) {
                    errors.push(`${label}: file exceeds the candidate file-size limit (${childPath})`);
                    continue;
                }
                aggregateBytes += metadata.size;
                if (aggregateBytes > RELEASE_PROOF_ARCHIVE_LIMITS.expandedBytes) {
                    errors.push(`${label}: traversal exceeds the aggregate byte limit`);
                    return files.sort();
                }
                if (containedRealPath(root, child, `${label} file ${childPath}`, errors) !== undefined) {
                    files.push(childPath);
                }
            } else {
                errors.push(`${label}: unsupported entry ${childPath}`);
            }
        }
    }
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

function isConcreteInventoryFilePath(path: string): boolean {
    if (path.includes('\\') || path.includes('\0') || path.endsWith('/') || /[*?[\]{}]/u.test(path)) {
        return false;
    }
    const normalized = posix.normalize(path);
    return (
        !isAbsolute(path) &&
        normalized === path &&
        path !== '.' &&
        !path.startsWith('../') &&
        !path.includes('/../') &&
        !path.endsWith('/..')
    );
}

function webLlmRequiredLegalFilesFromInventory(inventory: ReleaseInventory): string[] {
    const surface = inventory.surfaces.find((entry) => entry.id === WEBLLM_SURFACE_ID);
    if (surface === undefined) {
        throw new Error(`release inventory is missing ${WEBLLM_SURFACE_ID} surface`);
    }
    const required = [
        ...new Set(
            surface.paths
                .filter((path) => path.startsWith(PUBLIC_LEGAL_PREFIX) && isConcreteInventoryFilePath(path))
                .map((path) => `${PACKAGED_LEGAL_PREFIX}${path.slice(PUBLIC_LEGAL_PREFIX.length)}`)
        ),
    ].sort();
    if (required.length === 0) {
        throw new Error(`release inventory ${WEBLLM_SURFACE_ID} surface declares no concrete public/legal files`);
    }
    return required;
}

export function webLlmRequiredLegalFiles(root: string): string[] {
    return webLlmRequiredLegalFilesFromInventory(readReleaseInventory(root));
}

function validateWebLlmLegalFiles(
    root: string,
    inventory: ReleaseInventory,
    packagedFiles: Record<string, string>,
    label: string,
    errors: string[],
    contentsPath?: string
): void {
    let requiredFiles: string[];
    try {
        requiredFiles = webLlmRequiredLegalFilesFromInventory(inventory);
    } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
        return;
    }
    for (const required of requiredFiles) {
        const sourcePath = resolve(root, 'public', ...required.split('/'));
        const packagedPath = contentsPath === undefined ? undefined : resolve(contentsPath, ...required.split('/'));
        const sourceDigest = sha256ContainedRegularFile(root, sourcePath);
        const contentsMatch =
            packagedPath === undefined ||
            (contentsPath !== undefined && sha256ContainedRegularFile(contentsPath, packagedPath) === sourceDigest);
        if (sourceDigest === undefined || packagedFiles[required] !== sourceDigest || !contentsMatch) {
            errors.push(`${label} WebLLM legal file ${required} is missing or drifted`);
        }
    }
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
        if (!existsSync(absolute)) {
            errors.push(`${label}: missing ${path}`);
            continue;
        }
        let actualHash: string | undefined;
        try {
            actualHash = sha256ContainedRegularFile(directory, absolute);
        } catch (error) {
            if (error instanceof FileReadLimitError) {
                errors.push(`${label}: file exceeds the candidate file-size limit for ${path}`);
                continue;
            }
            throw error;
        }
        if (actualHash === undefined) {
            errors.push(`${label}: missing or unsafe ${path}`);
        } else if (actualHash !== recorded[path]) {
            errors.push(`${label}: digest mismatch for ${path}`);
        }
    }
}

function fileMap(directory: string): Record<string, string> {
    const errors: string[] = [];
    const result: Record<string, string> = {};
    for (const path of listFiles(directory, 'contents', errors)) {
        const absolute = resolve(directory, ...path.split('/'));
        result[path] = sha256File(absolute);
    }
    if (errors.length > 0) {
        throw new Error(errors.join('\n'));
    }
    return result;
}

function rendererFileMap(directory: string): Record<string, string> {
    return Object.fromEntries(
        Object.entries(fileMap(directory))
            .filter(([path]) => !path.endsWith('.map'))
            .sort(([left], [right]) => left.localeCompare(right))
    );
}

function readJsonForValidation(root: string, path: string, label: string, errors: string[]): JsonRecord | undefined {
    try {
        const value = readJson(root, path);
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

type ArchiveEntry = {
    path: string;
    type: 'file' | 'directory' | 'symlink';
    expandedBytes: number;
    mode: number;
};

type ArchiveLimits = {
    entries: number;
    pathDepth: number;
    entryBytes: number;
    expandedBytes: number;
    candidateFileBytes: number;
};

type ZipArchiveRead = {
    entries: ArchiveEntry[];
    hashes: Map<string, string>;
    linkTargets: Map<string, Buffer>;
};

function archiveLimitError(message: string): Error {
    return new Error(`release archive limit exceeded: ${message}`);
}

function validateArchiveEntryBounds(
    entries: readonly ArchiveEntry[],
    label: string,
    errors: string[],
    limits: ArchiveLimits = RELEASE_PROOF_ARCHIVE_LIMITS
): void {
    if (entries.length === 0) {
        errors.push(`${label} is empty`);
        return;
    }
    if (entries.length > limits.entries) {
        errors.push(`${label} exceeds the entry count limit`);
    }
    let total = 0;
    for (const entry of entries) {
        const depth = entry.path.split('/').filter(Boolean).length;
        if (depth > limits.pathDepth) {
            errors.push(`${label} contains a path exceeding the depth limit`);
        }
        if (entry.expandedBytes > limits.entryBytes) {
            errors.push(`${label} contains an entry exceeding the expanded-size limit`);
        }
        total += entry.expandedBytes;
        if (total > limits.expandedBytes) {
            errors.push(`${label} exceeds the aggregate expanded-size limit`);
            break;
        }
    }
}

function normalizedArchivePath(path: string): string {
    return path.replace(/^\.\//u, '').replace(/\/$/u, '');
}

function archivePathIsUnsafe(path: string): boolean {
    return path.startsWith('/') || path.includes('\\') || path.split('/').includes('..');
}

function archivePathContainsGitMetadata(path: string): boolean {
    return path.split('/').some((segment) => segment.toLowerCase() === '.git');
}

function streamTarArchive(
    path: string,
    destination?: string,
    limits: ArchiveLimits = RELEASE_PROOF_ARCHIVE_LIMITS
): ArchiveEntry[] {
    const entries: ArchiveEntry[] = [];
    let total = 0;
    const input = openSync(path, 'r');
    const outputs = new Set<number>();
    try {
        const parser = new TarParser({
            file: path,
            strict: true,
            maxMetaEntrySize: Math.min(RELEASE_PROOF_TYPE_LIMITS.jsonBytes, limits.entryBytes),
            onReadEntry(entry) {
                let type: ArchiveEntry['type'] | undefined;
                if (entry.type === 'File') {
                    type = 'file';
                } else if (entry.type === 'Directory') {
                    type = 'directory';
                }
                if (type === undefined) {
                    throw new Error(`unsupported TAR entry metadata: ${entry.type}`);
                }
                const archivePath = normalizedArchivePath(entry.path);
                if (archivePath.split('/').filter(Boolean).length > limits.pathDepth) {
                    throw archiveLimitError('a path exceeds the depth limit');
                }
                if (
                    destination !== undefined &&
                    (archivePathIsUnsafe(archivePath) || archivePathContainsGitMetadata(archivePath))
                ) {
                    throw new Error('TAR entry path is unsafe for extraction');
                }
                if (entry.size > limits.entryBytes) {
                    throw archiveLimitError('an entry exceeds the expanded-size limit');
                }
                entries.push({ path: archivePath, type, expandedBytes: entry.size, mode: entry.mode ?? 0 });
                if (entries.length > limits.entries) {
                    throw archiveLimitError('entry count exceeds the limit');
                }
                let actualBytes = 0;
                let output: number | undefined;
                let outputPath: string | undefined;
                if (destination !== undefined && archivePath.length > 0) {
                    outputPath = resolve(destination, ...archivePath.split('/'));
                    if (!isContained(destination, outputPath)) {
                        throw new Error('TAR entry path escapes the extraction root');
                    }
                    if (type === 'directory') {
                        mkdirSync(outputPath, { recursive: true });
                    } else {
                        mkdirSync(dirname(outputPath), { recursive: true });
                        output = openSync(outputPath, 'w', entry.mode ?? 0o644);
                        outputs.add(output);
                    }
                }
                entry.on('data', (chunk: Buffer) => {
                    actualBytes += chunk.length;
                    total += chunk.length;
                    if (actualBytes > limits.entryBytes) {
                        throw archiveLimitError('an entry exceeds the actual expanded-size limit');
                    }
                    if (total > limits.expandedBytes) {
                        throw archiveLimitError('actual aggregate expanded bytes exceed the limit');
                    }
                    if (output !== undefined) {
                        writeSync(output, chunk);
                    }
                });
                entry.on('end', () => {
                    if (actualBytes !== entry.size) {
                        throw new Error('TAR entry expanded bytes do not match its header');
                    }
                    if (output !== undefined) {
                        closeSync(output);
                        outputs.delete(output);
                        if (outputPath !== undefined) {
                            chmodSync(outputPath, (entry.mode ?? 0o644) & 0o777);
                        }
                    }
                });
                entry.resume();
            },
        });
        const size = statSync(path).size;
        let position = 0;
        while (position < size) {
            const chunk = Buffer.allocUnsafe(Math.min(HASH_CHUNK_BYTES, size - position));
            const bytesRead = readSync(input, chunk, 0, chunk.length, position);
            if (bytesRead === 0) {
                throw new Error('TAR archive is truncated');
            }
            parser.write(chunk.subarray(0, bytesRead));
            position += bytesRead;
        }
        parser.end();
        return entries.filter((entry) => entry.path.length > 0);
    } catch (error) {
        if (destination !== undefined) {
            rmSync(destination, { recursive: true, force: true });
        }
        throw error;
    } finally {
        for (const output of outputs) {
            closeSync(output);
        }
        closeSync(input);
    }
}

function tarEntries(path: string, errors: string[]): ArchiveEntry[] {
    try {
        return streamTarArchive(path);
    } catch (error) {
        errors.push(
            error instanceof Error ? `tar archive is unreadable: ${error.message}` : 'tar archive is unreadable'
        );
        return [];
    }
}

function readZipBuffer(descriptor: number, length: number, position: number): Buffer | undefined {
    const value = Buffer.alloc(length);
    return readSync(descriptor, value, 0, length, position) === length ? value : undefined;
}

function zipEntries(
    path: string,
    errors: string[],
    limits: ArchiveLimits = RELEASE_PROOF_ARCHIVE_LIMITS
): ArchiveEntry[] {
    let descriptor: number | undefined;
    try {
        const size = statSync(path).size;
        if (size > limits.candidateFileBytes) {
            errors.push('zip archive exceeds the candidate file-size limit');
            return [];
        }
        descriptor = openSync(path, 'r');
        const tailLength = Math.min(size, 65_557);
        const tail = readZipBuffer(descriptor, tailLength, size - tailLength);
        if (tail === undefined) {
            throw new Error('end of central directory is truncated');
        }
        let endOffset = -1;
        for (let offset = tail.length - 22; offset >= 0; offset -= 1) {
            if (tail.readUInt32LE(offset) === 0x06054b50) {
                endOffset = offset;
                break;
            }
        }
        if (endOffset === -1 || tail.readUInt16LE(endOffset + 20) !== tail.length - endOffset - 22) {
            throw new Error('end of central directory is invalid');
        }
        const disk = tail.readUInt16LE(endOffset + 4);
        const centralDisk = tail.readUInt16LE(endOffset + 6);
        const entriesOnDisk = tail.readUInt16LE(endOffset + 8);
        const entryCount = tail.readUInt16LE(endOffset + 10);
        const centralBytes = tail.readUInt32LE(endOffset + 12);
        const centralOffset = tail.readUInt32LE(endOffset + 16);
        if (
            disk !== 0 ||
            centralDisk !== 0 ||
            entriesOnDisk !== entryCount ||
            entryCount === 0xffff ||
            centralBytes === 0xffffffff ||
            centralOffset === 0xffffffff
        ) {
            throw new Error('ZIP64 and multi-disk metadata are unsupported');
        }
        if (entryCount > limits.entries) {
            throw archiveLimitError('entry count exceeds the limit');
        }
        if (
            centralBytes > limits.entries * 4096 ||
            centralOffset + centralBytes > size ||
            centralOffset + centralBytes > size - tailLength + endOffset
        ) {
            throw new Error('central directory is outside the archive bounds');
        }
        const entries: ArchiveEntry[] = [];
        let position = centralOffset;
        let total = 0;
        for (let index = 0; index < entryCount; index += 1) {
            const header = readZipBuffer(descriptor, 46, position);
            if (header === undefined || header.readUInt32LE(0) !== 0x02014b50) {
                throw new Error('central directory entry is truncated');
            }
            const flags = header.readUInt16LE(8);
            const method = header.readUInt16LE(10);
            const expandedBytes = header.readUInt32LE(24);
            const pathLength = header.readUInt16LE(28);
            const extraLength = header.readUInt16LE(30);
            const commentLength = header.readUInt16LE(32);
            const madeBy = header.readUInt16LE(4) >> 8;
            const attributes = header.readUInt32LE(38);
            const entryLength = 46 + pathLength + extraLength + commentLength;
            if (
                pathLength === 0 ||
                position + entryLength > centralOffset + centralBytes ||
                flags & 0x1 ||
                (method !== 0 && method !== 8) ||
                expandedBytes === 0xffffffff
            ) {
                throw new Error('unsupported ZIP entry metadata');
            }
            const bytes = readZipBuffer(descriptor, pathLength, position + 46);
            if (
                bytes === undefined ||
                bytes.includes(0) ||
                ((flags & 0x800) === 0 && bytes.some((value) => value > 0x7f))
            ) {
                throw new Error('unsupported ZIP entry filename metadata');
            }
            const rawPath = bytes.toString('utf8');
            const archivePath = rawPath.replace(/^\.\//u, '').replace(/\/$/u, '');
            const mode = attributes >>> 16;
            const modeType = mode & 0o170000;
            let type: ArchiveEntry['type'] | undefined;
            if (madeBy === 3 && modeType === 0o120000) {
                type = 'symlink';
            } else if (madeBy === 3 && modeType !== 0 && modeType !== 0o100000 && modeType !== 0o040000) {
                type = undefined;
            } else if (modeType === 0o040000 || rawPath.endsWith('/')) {
                type = 'directory';
            } else {
                type = 'file';
            }
            if (type === undefined) {
                throw new Error('unsupported ZIP entry metadata');
            }
            if (expandedBytes > limits.entryBytes) {
                throw archiveLimitError('an entry exceeds the expanded-size limit');
            }
            total += expandedBytes;
            if (total > limits.expandedBytes) {
                throw archiveLimitError('aggregate expanded bytes exceed the limit');
            }
            entries.push({ path: archivePath, type, expandedBytes, mode: mode & 0o777 });
            position += entryLength;
        }
        if (position !== centralOffset + centralBytes) {
            throw new Error('central directory contains trailing metadata');
        }
        return entries.filter((entry) => entry.path.length > 0);
    } catch (error) {
        errors.push(
            error instanceof Error ? `zip archive is unreadable: ${error.message}` : 'zip archive is unreadable'
        );
        return [];
    } finally {
        if (descriptor !== undefined) {
            closeSync(descriptor);
        }
    }
}

function streamZipArchive(
    archive: string,
    declaredEntries: readonly ArchiveEntry[],
    options: {
        destination?: string;
        hashFiles?: boolean;
        rejectGitMetadata?: boolean;
        limits?: ArchiveLimits;
    } = {}
): ZipArchiveRead {
    const limits = options.limits ?? RELEASE_PROOF_ARCHIVE_LIMITS;
    const declaredByPath = new Map(declaredEntries.map((entry) => [entry.path, entry]));
    const entries: ArchiveEntry[] = [];
    const hashes = new Map<string, string>();
    const linkTargets = new Map<string, Buffer>();
    const seen = new Set<string>();
    const outputs = new Set<number>();
    let aggregateBytes = 0;
    let failure: Error | undefined;
    try {
        const unzip = new Unzip((file) => {
            if (failure !== undefined) {
                file.terminate();
                return;
            }
            try {
                const path = normalizedArchivePath(file.name);
                const declared = declaredByPath.get(path);
                if (path.length === 0 || archivePathIsUnsafe(path)) {
                    throw new Error('ZIP local entry path is unsafe');
                }
                if (options.rejectGitMetadata === true && archivePathContainsGitMetadata(path)) {
                    throw new Error('ZIP local entry contains repository metadata');
                }
                if (path.split('/').length > limits.pathDepth) {
                    throw archiveLimitError('an actual path exceeds the depth limit');
                }
                if (declared === undefined || seen.has(path)) {
                    throw new Error('ZIP local entries do not match the central directory');
                }
                if ((file.name.endsWith('/') ? 'directory' : declared.type) !== declared.type) {
                    throw new Error('ZIP local entry type does not match the central directory');
                }
                seen.add(path);
                if (seen.size > limits.entries) {
                    throw archiveLimitError('actual entry count exceeds the limit');
                }
                const hash = options.hashFiles === true && declared.type === 'file' ? createHash('sha256') : undefined;
                const targetChunks: Buffer[] = [];
                let actualBytes = 0;
                let output: number | undefined;
                let outputPath: string | undefined;
                if (options.destination !== undefined) {
                    outputPath = resolve(options.destination, ...path.split('/'));
                    if (!isContained(options.destination, outputPath)) {
                        throw new Error('ZIP entry escapes the extraction root');
                    }
                    if (declared.type === 'directory') {
                        mkdirSync(outputPath, { recursive: true });
                    } else if (declared.type === 'file') {
                        mkdirSync(dirname(outputPath), { recursive: true });
                        output = openSync(outputPath, 'w', declared.mode === 0 ? 0o644 : declared.mode);
                        outputs.add(output);
                    }
                }
                file.ondata = (error, data, final) => {
                    if (failure !== undefined) {
                        return;
                    }
                    try {
                        if (error !== null) {
                            throw error;
                        }
                        actualBytes += data.length;
                        aggregateBytes += data.length;
                        if (actualBytes > limits.entryBytes) {
                            throw archiveLimitError('an entry exceeds the actual expanded-size limit');
                        }
                        if (aggregateBytes > limits.expandedBytes) {
                            throw archiveLimitError('actual aggregate expanded bytes exceed the limit');
                        }
                        if (declared.type === 'directory' && data.length > 0) {
                            throw new Error('ZIP directory entry contains data');
                        }
                        hash?.update(data);
                        if (declared.type === 'symlink' && data.length > 0) {
                            if (actualBytes > 8192) {
                                throw archiveLimitError('a symbolic link target exceeds the limit');
                            }
                            targetChunks.push(Buffer.from(data));
                        }
                        if (output !== undefined && data.length > 0) {
                            writeSync(output, data);
                        }
                        if (!final) {
                            return;
                        }
                        if (
                            actualBytes !== declared.expandedBytes ||
                            (file.originalSize !== undefined && actualBytes !== file.originalSize)
                        ) {
                            throw new Error('ZIP entry expanded bytes do not match its declarations');
                        }
                        if (output !== undefined) {
                            closeSync(output);
                            outputs.delete(output);
                            if (outputPath !== undefined) {
                                chmodSync(outputPath, declared.mode === 0 ? 0o644 : declared.mode);
                            }
                        }
                        entries.push({ ...declared, expandedBytes: actualBytes });
                        if (hash !== undefined) {
                            hashes.set(path, hash.digest('hex'));
                        }
                        if (declared.type === 'symlink') {
                            linkTargets.set(path, Buffer.concat(targetChunks, actualBytes));
                        }
                    } catch (error) {
                        failure = error instanceof Error ? error : new Error(String(error));
                        file.terminate();
                    }
                };
                file.start();
            } catch (error) {
                failure = error instanceof Error ? error : new Error(String(error));
                file.terminate();
            }
        });
        unzip.register(UnzipInflate);
        const descriptor = openSync(archive, 'r');
        try {
            const size = statSync(archive).size;
            let position = 0;
            while (position < size) {
                const chunk = Buffer.allocUnsafe(Math.min(HASH_CHUNK_BYTES, size - position));
                const bytesRead = readSync(descriptor, chunk, 0, chunk.length, position);
                if (bytesRead === 0) {
                    throw new Error('ZIP archive is truncated');
                }
                unzip.push(chunk.subarray(0, bytesRead), position + bytesRead === size);
                if (failure !== undefined) {
                    throw failure;
                }
                position += bytesRead;
            }
        } finally {
            closeSync(descriptor);
        }
        if (failure !== undefined) {
            throw failure;
        }
        if (seen.size !== declaredEntries.length || entries.length !== declaredEntries.length) {
            throw new Error('ZIP local entries do not match the central directory');
        }
        return { entries, hashes, linkTargets };
    } catch (error) {
        if (options.destination !== undefined) {
            rmSync(options.destination, { recursive: true, force: true });
        }
        throw error;
    } finally {
        for (const output of outputs) {
            closeSync(output);
        }
    }
}

function archiveEntries(path: string, type: 'tar' | 'zip', errors: string[]): ArchiveEntry[] {
    return type === 'tar' ? tarEntries(path, errors) : zipEntries(path, errors);
}

function validateArchivePaths(
    entries: readonly ArchiveEntry[],
    label: string,
    errors: string[],
    rejectGitMetadata = false
): void {
    validateArchiveEntryBounds(entries, label, errors);
    const paths = entries.map((entry) => entry.path);
    if (paths.some(archivePathIsUnsafe)) {
        errors.push(`${label} contains an unsafe path`);
    }
    if (rejectGitMetadata && paths.some(archivePathContainsGitMetadata)) {
        errors.push(`${label} contains repository metadata`);
    }
    if (new Set(paths).size !== paths.length) {
        errors.push(`${label} contains duplicate paths`);
    }
}

function archiveHasPath(entries: readonly ArchiveEntry[], required: string): boolean {
    return entries.some((entry) => entry.path === required || entry.path.endsWith(`/${required}`));
}

function validateZipLinks(
    entries: readonly ArchiveEntry[],
    targets: ReadonlyMap<string, Buffer>,
    label: string,
    allowContainedLinks: boolean,
    errors: string[]
): void {
    const links = new Map<string, string>();
    for (const entry of entries) {
        if (entry.type !== 'symlink') {
            continue;
        }
        if (!allowContainedLinks) {
            errors.push(`${label} contains a symbolic link: ${entry.path}`);
            continue;
        }
        const targetBytes = targets.get(entry.path);
        const target = targetBytes?.toString('utf8');
        if (
            target === undefined ||
            target.length === 0 ||
            target.includes('\0') ||
            target.includes('\\') ||
            posix.isAbsolute(target)
        ) {
            errors.push(`${label} symbolic link ${entry.path} has an unsafe target`);
            continue;
        }
        const resolved = posix.normalize(posix.join(posix.dirname(entry.path), target));
        if (resolved === '..' || resolved.startsWith('../')) {
            errors.push(`${label} symbolic link ${entry.path} escapes the package`);
            continue;
        }
        links.set(entry.path, resolved);
    }
    for (const entry of links.keys()) {
        const visited = new Set<string>([entry]);
        let target = links.get(entry);
        while (target !== undefined && links.has(target)) {
            if (visited.has(target)) {
                errors.push(`${label} symbolic link ${entry} forms a cycle`);
                break;
            }
            visited.add(target);
            target = links.get(target);
        }
    }
}

function materializeZipLinks(destination: string, targets: ReadonlyMap<string, Buffer>): void {
    for (const [path, targetBytes] of targets) {
        const output = resolve(destination, ...path.split('/'));
        mkdirSync(dirname(output), { recursive: true });
        symlinkSync(targetBytes.toString('utf8'), output);
    }
}

function extractTarArchive(path: string, destination: string): void {
    try {
        streamTarArchive(path, destination);
    } catch {
        throw new Error('tar archive extraction failed');
    }
}

function validateExtractedPackage(root: string, errors: string[]): void {
    listFiles(root, 'desktop extracted package', errors, true);
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
    const errorCount = errors.length;
    const entries = archiveEntries(archive, 'tar', errors);
    validateArchivePaths(entries, `${label} archive`, errors, true);
    const prefix = `${prefixName}-${expectedRevision}`;
    if (entries.some((entry) => entry.path !== prefix && !entry.path.startsWith(`${prefix}/`))) {
        errors.push(`${label} archive is not revision-rooted`);
    }
    for (const required of requiredPaths) {
        if (!entries.some((entry) => entry.path === `${prefix}/${required}`)) {
            errors.push(`${label} archive is missing ${required}`);
        }
    }
    const expectedTree = commitTree(commitObject, expectedRevision, label, errors);
    if (errors.length > errorCount || entries.length === 0 || expectedTree === undefined) {
        return;
    }

    const temporary = mkdtempSync(join(tmpdir(), 'sourdaw-release-tree-'));
    try {
        extractTarArchive(archive, temporary);
        const sourceRoot = join(temporary, prefix);
        if (
            !existsSync(sourceRoot) ||
            !lstatSync(sourceRoot).isDirectory() ||
            containedRealPath(temporary, sourceRoot, `${label} archive root`, errors) === undefined
        ) {
            errors.push(`${label} archive root is missing or unsafe`);
            return;
        }
        const template = join(temporary, 'git-template');
        const gitWorkspace = join(temporary, 'git-workspace');
        const globalConfig = join(temporary, 'gitconfig');
        mkdirSync(template);
        mkdirSync(gitWorkspace);
        writeFileSync(globalConfig, '');
        const environment = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
        const gitOptions = {
            cwd: temporary,
            env: { ...environment, GIT_CONFIG_GLOBAL: globalConfig, GIT_CONFIG_NOSYSTEM: '1' },
            stdio: 'ignore' as const,
        };
        execFileSync('git', ['init', '--quiet', `--template=${template}`, gitWorkspace], gitOptions);
        const gitDirectory = join(gitWorkspace, '.git');
        const gitConfig = [
            `--git-dir=${gitDirectory}`,
            `--work-tree=${sourceRoot}`,
            '-c',
            `core.hooksPath=${devNull}`,
            '-c',
            'core.autocrlf=false',
            '-c',
            'core.bare=false',
        ];
        execFileSync('git', [...gitConfig, 'add', '-f', '--all'], gitOptions);
        const actualTree = execFileSync('git', [...gitConfig, 'write-tree'], {
            ...gitOptions,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
        }).trim();
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
        return execFileSync('tar', ['-xOzf', archive, `${prefix}/${path}`], {
            maxBuffer: RELEASE_PROOF_TYPE_LIMITS.buildInputBytes,
        });
    } catch {
        return undefined;
    }
}

function validateSourceManifest(
    candidate: string,
    proof: JsonRecord,
    expectedRevision: string,
    errors: string[],
    snapshotRoot: string,
    snapshotBudget: CandidateSnapshotBudget,
    fileReader: ReleaseProofFileReader
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
        RELEASE_PROOF_TYPE_LIMITS.jsonBytes,
        errors,
        snapshotRoot,
        snapshotBudget,
        fileReader
    );
    const archive = verifyFileHash(
        candidate,
        source.archivePath,
        source.archiveSha256,
        'source archive',
        RELEASE_PROOF_ARCHIVE_LIMITS.candidateFileBytes,
        errors,
        snapshotRoot,
        snapshotBudget,
        fileReader
    );
    const commitPath = verifyFileHash(
        candidate,
        source.commitPath,
        source.commitSha256,
        'source commit object',
        RELEASE_PROOF_TYPE_LIMITS.commitObjectBytes,
        errors,
        snapshotRoot,
        snapshotBudget,
        fileReader
    );
    const commitObject =
        commitPath === undefined
            ? undefined
            : readCommitObject(snapshotRoot, commitPath.snapshotPath, 'source', errors);
    if (archive !== undefined && commitObject !== undefined) {
        validateGitArchive(
            archive.snapshotPath,
            commitObject,
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
    const manifest = readJsonForValidation(snapshotRoot, manifestPath.snapshotPath, 'source manifest', errors);
    if (manifest === undefined) {
        return;
    }
    const tree = commitObject === undefined ? undefined : commitTree(commitObject, expectedRevision, 'source', errors);
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

function validateWebArchive(path: string, errors: string[]): ZipArchiveRead | undefined {
    const errorCount = errors.length;
    const entries = archiveEntries(path, 'zip', errors);
    validateArchivePaths(entries, 'web archive', errors);
    if (errors.length !== errorCount) {
        return undefined;
    }
    let archive: ZipArchiveRead;
    try {
        archive = streamZipArchive(path, entries, { hashFiles: true });
    } catch (error) {
        errors.push(
            error instanceof Error ? `zip archive is unreadable: ${error.message}` : 'zip archive is unreadable'
        );
        return undefined;
    }
    validateZipLinks(archive.entries, archive.linkTargets, 'web archive', false, errors);
    for (const required of ['index.html', 'web-artifact-manifest.json']) {
        if (!archiveHasPath(archive.entries, required)) {
            errors.push(`web archive is missing ${required}`);
        }
    }
    if (!archive.entries.some((entry) => entry.path.startsWith('assets/') || entry.path.includes('/assets/'))) {
        errors.push('web archive is missing assets');
    }
    return errors.length === errorCount ? archive : undefined;
}

function validateWebManifest(
    root: string,
    candidate: string,
    proof: JsonRecord,
    expectedRevision: string,
    errors: string[],
    releaseInventory: ReleaseInventory,
    snapshotRoot: string,
    snapshotBudget: CandidateSnapshotBudget,
    fileReader: ReleaseProofFileReader
): Record<string, string> | undefined {
    const web = requiredRecord(proof, 'web', 'release proof', errors);
    if (web === undefined) {
        return undefined;
    }
    const manifestPath = verifyFileHash(
        candidate,
        web.manifestPath,
        web.manifestSha256,
        'web manifest',
        RELEASE_PROOF_TYPE_LIMITS.jsonBytes,
        errors,
        snapshotRoot,
        snapshotBudget,
        fileReader
    );
    const archivePath = verifyFileHash(
        candidate,
        web.archivePath,
        web.archiveSha256,
        'web archive',
        RELEASE_PROOF_ARCHIVE_LIMITS.candidateFileBytes,
        errors,
        snapshotRoot,
        snapshotBudget,
        fileReader
    );
    const contentsPath = candidatePath(candidate, web.contentsPath, 'web.contentsPath', errors);
    const archive = archivePath === undefined ? undefined : validateWebArchive(archivePath.snapshotPath, errors);
    if (contentsPath === undefined || manifestPath === undefined) {
        return undefined;
    }
    const manifest = readJsonForValidation(snapshotRoot, manifestPath.snapshotPath, 'web manifest', errors);
    if (manifest === undefined) {
        return undefined;
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
        const sourceDigest = sha256ContainedRegularFile(root, sourcePath);
        const webDigest = sha256ContainedRegularFile(contentsPath, webPath);
        if (sourceDigest === undefined || sourceDigest !== webDigest) {
            errors.push(`web legal file ${required} is missing or drifted`);
        }
    }
    validateWebLlmLegalFiles(root, releaseInventory, files, 'web', errors, contentsPath);
    if (archivePath !== undefined && archive !== undefined) {
        const archiveFiles = archive.entries.map((entry) => entry.path).sort();
        const expectedFiles = ['web-artifact-manifest.json', ...Object.keys(files)].sort();
        if (!sameValue(archiveFiles, expectedFiles)) {
            errors.push('web archive file census does not match web contents');
        }
        for (const path of expectedFiles) {
            const archived = archive.hashes.get(path);
            const adjacentDigest =
                path === 'web-artifact-manifest.json'
                    ? manifestPath.digest
                    : sha256ContainedRegularFile(contentsPath, resolve(contentsPath, ...path.split('/')));
            if (archived === undefined || archived !== adjacentDigest) {
                errors.push(`web archive bytes do not match web contents for ${path}`);
            }
        }
    }
    const contract = readJsonForValidation(
        root,
        resolve(root, 'release/web-artifact-manifest.json'),
        'web contract',
        errors
    );
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
    return files;
}

function machOError(path: string, expectedFileType: number): string | undefined {
    if (!existsSync(path) || !lstatSync(path).isFile()) {
        return 'file is missing';
    }
    const descriptor = openSync(path, 'r');
    let bytes: Buffer;
    try {
        const header = readZipBuffer(descriptor, MACH_HEADER_64_SIZE, 0);
        if (header === undefined || header.readUInt32LE(0) !== 0xfeedfacf) {
            return 'header is not a thin 64-bit little-endian Mach-O';
        }
        const commandBytes = header.readUInt32LE(20);
        if (commandBytes > RELEASE_PROOF_TYPE_LIMITS.machLoadCommandBytes) {
            return 'load-command table exceeds the read limit';
        }
        bytes = readZipBuffer(descriptor, MACH_HEADER_64_SIZE + commandBytes, 0) ?? Buffer.alloc(0);
    } finally {
        closeSync(descriptor);
    }
    if (bytes.length < MACH_HEADER_64_SIZE || bytes.readUInt32LE(0) !== 0xfeedfacf) {
        return 'header is not a thin 64-bit little-endian Mach-O';
    }
    if (bytes.readUInt32LE(4) !== CPU_TYPE_ARM64) {
        return 'CPU type is not arm64';
    }
    if (bytes.readUInt32LE(12) !== expectedFileType) {
        return `file type is not ${String(expectedFileType)}`;
    }
    const commandCount = bytes.readUInt32LE(16);
    const commandBytes = bytes.readUInt32LE(20);
    const commandEnd = MACH_HEADER_64_SIZE + commandBytes;
    if (commandCount === 0 || commandBytes === 0 || commandEnd > bytes.length) {
        return 'load-command table is empty or truncated';
    }
    let offset = MACH_HEADER_64_SIZE;
    for (let index = 0; index < commandCount; index += 1) {
        if (offset + 8 > commandEnd) {
            return 'load-command header is truncated';
        }
        const command = bytes.readUInt32LE(offset);
        const commandSize = bytes.readUInt32LE(offset + 4);
        if (command === 0 || commandSize < 8 || commandSize % 8 !== 0 || offset + commandSize > commandEnd) {
            return 'load-command table is malformed';
        }
        offset += commandSize;
    }
    return offset === commandEnd ? undefined : 'load-command byte count does not match the header';
}

function validateMachO(path: string, expectedFileType: number, label: string, errors: string[]): void {
    const error = machOError(path, expectedFileType);
    if (error !== undefined) {
        errors.push(`${label} is not a valid thin arm64 Mach-O ${String(expectedFileType)}: ${error}`);
    }
}

function validatePackagedFuses(path: string, errors: string[]): void {
    if (!existsSync(path) || !lstatSync(path).isFile()) {
        errors.push('desktop Electron framework fuse wire is missing');
        return;
    }
    const descriptor = openSync(path, 'r');
    const sentinels: number[] = [];
    try {
        const size = statSync(path).size;
        let position = 0;
        let carry = Buffer.alloc(0);
        while (position < size && sentinels.length < 2) {
            const chunk = Buffer.allocUnsafe(Math.min(HASH_CHUNK_BYTES, size - position));
            const bytesRead = readSync(descriptor, chunk, 0, chunk.length, position);
            if (bytesRead === 0) {
                break;
            }
            const data = Buffer.concat([carry, chunk.subarray(0, bytesRead)]);
            let offset = data.indexOf(FUSE_SENTINEL);
            while (offset !== -1) {
                sentinels.push(position - carry.length + offset);
                offset = data.indexOf(FUSE_SENTINEL, offset + 1);
            }
            carry = data.subarray(Math.max(0, data.length - FUSE_SENTINEL.length + 1));
            position += bytesRead;
        }
        const [sentinel] = sentinels;
        if (sentinel === undefined || sentinels.length !== 1) {
            errors.push('desktop Electron framework must contain exactly one fuse wire');
            return;
        }
        const header = sentinel + FUSE_SENTINEL.length;
        const prefix = readZipBuffer(descriptor, 2, header);
        if (prefix === undefined || prefix[0] !== 1) {
            errors.push('desktop Electron framework fuse wire version is invalid');
            return;
        }
        const length = prefix[1] ?? 0;
        if (length === 0 || length > RELEASE_PROOF_TYPE_LIMITS.fuseWireBytes) {
            errors.push('desktop Electron framework fuse wire is truncated');
            return;
        }
        const states = readZipBuffer(descriptor, length, header + 2);
        if (states === undefined) {
            errors.push('desktop Electron framework fuse wire is truncated');
            return;
        }
        const wire: Partial<Record<FuseV1Options, FuseState>> = {};
        for (let index = 0; index < states.length; index += 1) {
            wire[index as FuseV1Options] = states[index];
        }
        const mismatches = findFuseMismatches(wire);
        if (mismatches.length > 0) {
            errors.push(`desktop Electron REQUIRED_FUSES mismatch: ${mismatches.join('; ')}`);
        }
    } finally {
        closeSync(descriptor);
    }
}

function validateAsarHeader(path: string): void {
    if (!existsSync(path) || !lstatSync(path).isFile()) {
        throw new Error('ASAR file is missing');
    }
    const descriptor = openSync(path, 'r');
    try {
        const prefix = readZipBuffer(descriptor, 8, 0);
        if (prefix === undefined) {
            throw new Error('ASAR metadata header is truncated');
        }
        const headerBytes = prefix.readUInt32LE(4);
        if (
            headerBytes === 0 ||
            headerBytes > RELEASE_PROOF_TYPE_LIMITS.asarHeaderBytes ||
            headerBytes + 8 > statSync(path).size
        ) {
            throw new Error('ASAR metadata header exceeds the read limit');
        }
    } finally {
        closeSync(descriptor);
    }
}

function asarRendererFiles(path: string, errors: string[]): Record<string, string> {
    const files: Record<string, string> = {};
    try {
        validateAsarHeader(path);
        const archivePaths = listPackage(path, { isPack: false });
        if (archivePaths.length > RELEASE_PROOF_ARCHIVE_LIMITS.entries) {
            throw archiveLimitError('ASAR metadata exceeds the entry count limit');
        }
        let aggregateBytes = 0;
        for (const archivePath of archivePaths) {
            const normalized = archivePath.replace(/^\//u, '');
            if (normalized.split('/').filter(Boolean).length > RELEASE_PROOF_ARCHIVE_LIMITS.pathDepth) {
                throw archiveLimitError('ASAR metadata contains a path exceeding the depth limit');
            }
            if (!normalized.startsWith('dist/')) {
                continue;
            }
            const metadata = statFile(path, normalized, false);
            if ('files' in metadata) {
                continue;
            }
            if ('link' in metadata || metadata.unpacked) {
                errors.push(`desktop app.asar renderer contains unsupported entry ${normalized}`);
                continue;
            }
            if (metadata.size > RELEASE_PROOF_TYPE_LIMITS.asarRendererEntryBytes) {
                throw archiveLimitError('an ASAR renderer entry exceeds the read limit');
            }
            aggregateBytes += metadata.size;
            if (aggregateBytes > RELEASE_PROOF_ARCHIVE_LIMITS.expandedBytes) {
                throw archiveLimitError('ASAR renderer bytes exceed the aggregate limit');
            }
            files[normalized.slice('dist/'.length)] = sha256Bytes(extractFile(path, normalized, false));
        }
    } catch (error) {
        errors.push(
            `desktop app.asar could not be inspected: ${error instanceof Error ? error.message : String(error)}`
        );
    }
    return Object.fromEntries(Object.entries(files).sort(([left], [right]) => left.localeCompare(right)));
}

type DesktopSnapshot = {
    files: Record<string, string>;
    archiveSha256: string;
    rendererFiles: Record<string, string>;
    ffmpegSha256: string;
};

function requiredFuseClaims(): Record<string, boolean> {
    return Object.fromEntries([...REQUIRED_FUSES].map(([fuse, enabled]) => [FuseV1Options[fuse], enabled]));
}

function desktopSnapshot(archive: string): DesktopSnapshot {
    const errors: string[] = [];
    const entries = archiveEntries(archive, 'zip', errors);
    validateArchivePaths(entries, 'desktop archive', errors, true);
    if (entries.some((entry) => entry.path !== DESKTOP_APP_ROOT && !entry.path.startsWith(`${DESKTOP_APP_ROOT}/`))) {
        errors.push('desktop archive must contain exactly one top-level Sourdaw.app');
    }
    const temporary = mkdtempSync(join(tmpdir(), 'sourdaw-desktop-proof-'));
    try {
        if (errors.length === 0) {
            try {
                const extracted = streamZipArchive(archive, entries, {
                    destination: temporary,
                    rejectGitMetadata: true,
                });
                validateZipLinks(extracted.entries, extracted.linkTargets, 'desktop archive', true, errors);
                if (errors.length === 0) {
                    materializeZipLinks(temporary, extracted.linkTargets);
                    validateExtractedPackage(temporary, errors);
                }
            } catch (error) {
                errors.push(
                    error instanceof Error
                        ? `desktop archive extraction failed: ${error.message}`
                        : 'desktop archive extraction failed'
                );
            }
        }
        const appRoot = join(temporary, DESKTOP_APP_ROOT);
        const infoPlist = join(appRoot, 'Contents/Info.plist');
        const resources = join(appRoot, 'Contents/Resources');
        if (
            !existsSync(infoPlist) ||
            !lstatSync(infoPlist).isFile() ||
            !existsSync(resources) ||
            !lstatSync(resources).isDirectory()
        ) {
            errors.push('desktop archive has an invalid macOS application layout');
        }
        const executable = join(temporary, DESKTOP_EXECUTABLE);
        const framework = join(temporary, DESKTOP_FRAMEWORK_EXECUTABLE);
        const nativeAddon = join(temporary, DESKTOP_NATIVE_ADDON);
        const ffmpeg = join(temporary, DESKTOP_FFMPEG);
        validateMachO(executable, MH_EXECUTE, 'desktop application executable', errors);
        validateMachO(framework, MH_DYLIB, 'desktop Electron framework', errors);
        validateMachO(nativeAddon, MH_BUNDLE, 'desktop native addon', errors);
        validateMachO(ffmpeg, MH_DYLIB, 'desktop packaged libffmpeg.dylib', errors);
        validatePackagedFuses(framework, errors);
        const rendererFiles = asarRendererFiles(join(temporary, DESKTOP_ASAR), errors);
        if (
            !Object.hasOwn(rendererFiles, 'index.html') ||
            !Object.keys(rendererFiles).some((path) => path.startsWith('assets/'))
        ) {
            errors.push('desktop app.asar renderer is missing the application entry or assets');
        }
        if (errors.length > 0) {
            throw new Error(errors.join('\n'));
        }
        return {
            files: fileMap(resources),
            archiveSha256: sha256File(archive),
            rendererFiles,
            ffmpegSha256: sha256File(ffmpeg),
        };
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
    errors: string[],
    releaseInventory: ReleaseInventory
): void {
    let snapshot: DesktopSnapshot | undefined;
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
        manifest.asarPath !== DESKTOP_ASAR ||
        manifest.packagedFfmpegPath !== DESKTOP_FFMPEG ||
        manifest.packagedFfmpegSha256 !== snapshot.ffmpegSha256 ||
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

    const receipt = isRecord(manifest.buildReceipt) ? manifest.buildReceipt : undefined;
    const electron = receipt !== undefined && isRecord(receipt.electronRuntime) ? receipt.electronRuntime : undefined;
    const rendererFiles = stringMap(receipt?.rendererFiles, 'desktop build receipt.rendererFiles', errors);
    if (
        receipt?.command !== 'pnpm desktop:build' ||
        receipt.sourceRevision !== manifest.sourceRevision ||
        receipt.rendererOutput !== 'dist' ||
        !sameValue(receipt.fuses, requiredFuseClaims()) ||
        electron?.revision !== runtimeContract.revision ||
        electron.ffmpegPath !== ELECTRON_RUNTIME_FFMPEG ||
        electron.ffmpegSha256 !== snapshot.ffmpegSha256 ||
        !sameValue(rendererFiles, snapshot.rendererFiles)
    ) {
        errors.push('desktop build receipt does not match the packaged renderer and Electron runtime');
    }
    const runtimeFfmpeg = resolve(root, ...ELECTRON_RUNTIME_FFMPEG.split('/'));
    if (!existsSync(runtimeFfmpeg) || !lstatSync(runtimeFfmpeg).isFile()) {
        errors.push('installed Electron runtime libffmpeg.dylib is missing');
    } else {
        validateMachO(runtimeFfmpeg, MH_DYLIB, 'installed Electron runtime libffmpeg.dylib', errors);
        if (
            containedRealPath(root, runtimeFfmpeg, 'installed Electron runtime libffmpeg.dylib', errors) ===
                undefined ||
            sha256File(runtimeFfmpeg) !== snapshot.ffmpegSha256
        ) {
            errors.push('packaged libffmpeg.dylib does not match the installed Electron runtime used by desktop:build');
        }
    }

    const sourceFiles = [
        ['legal/Apache-2.0.txt', 'public/legal/Apache-2.0.txt'],
        ['legal/DEPENDENCY-LICENSES.txt', 'public/legal/DEPENDENCY-LICENSES.txt'],
        ['legal/SOURDAW-NOTICE.txt', 'public/legal/SOURDAW-NOTICE.txt'],
        ['legal/RELINKING.md', 'public/legal/RELINKING.md'],
        ['legal/THIRD-PARTY-NOTICES.md', 'public/legal/THIRD-PARTY-NOTICES.md'],
    ] as const;
    for (const [packaged, source] of sourceFiles) {
        const sourcePath = resolve(root, ...source.split('/'));
        if (snapshot.files[packaged] !== sha256ContainedRegularFile(root, sourcePath)) {
            errors.push(`desktop legal file ${packaged} is missing or drifted`);
        }
    }
    validateWebLlmLegalFiles(root, releaseInventory, snapshot.files, 'desktop', errors);
    const target = runtimeContract.targets.find((item) => item.platform === 'darwin' && item.arch === 'arm64');
    if (target === undefined) {
        errors.push('Electron runtime contract has no darwin arm64 target');
    } else {
        if (snapshot.files['legal/electron-LICENSE.txt'] !== runtimeContract.licenseSha256) {
            errors.push('desktop Electron license bytes are missing or drifted');
        }
        if (snapshot.files['legal/electron-LICENSES.chromium.html'] !== target.noticesSha256) {
            errors.push('desktop Electron bundled notices are missing or drifted');
        }
    }
    const runtimeManifest = resolve(root, 'public/legal/ELECTRON-SOURCES.json');
    if (snapshot.files['legal/ELECTRON-SOURCES.json'] !== sha256ContainedRegularFile(root, runtimeManifest)) {
        errors.push('desktop packaged runtime manifest does not match the pinned runtime contract');
    }
}

function validateBuildMaterial(
    snapshotRoot: string,
    desktop: JsonRecord,
    runtimeContract: ElectronRuntimeContract,
    paths: {
        electronArchive?: VerifiedCandidateFile;
        electronCommit?: VerifiedCandidateFile;
        ffmpegArchive?: VerifiedCandidateFile;
        ffmpegCommit?: VerifiedCandidateFile;
        buildManifest?: VerifiedCandidateFile;
        buildInputs?: string;
    },
    errors: string[]
): Record<string, string> | undefined {
    const electronCommit =
        paths.electronCommit === undefined
            ? undefined
            : readCommitObject(snapshotRoot, paths.electronCommit.snapshotPath, 'Electron source', errors);
    const ffmpegCommit =
        paths.ffmpegCommit === undefined
            ? undefined
            : readCommitObject(snapshotRoot, paths.ffmpegCommit.snapshotPath, 'FFmpeg source', errors);
    const electronTree =
        electronCommit === undefined
            ? undefined
            : commitTree(electronCommit, runtimeContract.revision, 'Electron source', errors);
    const ffmpegTree =
        ffmpegCommit === undefined
            ? undefined
            : commitTree(ffmpegCommit, runtimeContract.ffmpeg.revision, 'FFmpeg source', errors);
    if (paths.electronArchive !== undefined && electronCommit !== undefined) {
        validateGitArchive(
            paths.electronArchive.snapshotPath,
            electronCommit,
            runtimeContract.revision,
            'electron',
            ELECTRON_FFMPEG_BUILD_INPUTS,
            'Electron source',
            errors
        );
    }
    if (paths.ffmpegArchive !== undefined && ffmpegCommit !== undefined) {
        validateGitArchive(
            paths.ffmpegArchive.snapshotPath,
            ffmpegCommit,
            runtimeContract.ffmpeg.revision,
            'ffmpeg',
            ['BUILD.gn', 'COPYING.LGPLv2.1'],
            'FFmpeg source',
            errors
        );
    }
    if (paths.buildManifest === undefined || paths.buildInputs === undefined) {
        return undefined;
    }
    const build = readJsonForValidation(
        snapshotRoot,
        paths.buildManifest.snapshotPath,
        'FFmpeg build material',
        errors
    );
    if (build === undefined) {
        return undefined;
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
            const archived = archiveFileBytes(paths.electronArchive.snapshotPath, prefix, path);
            const adjacent = join(paths.buildInputs, ...path.split('/'));
            if (
                archived === undefined ||
                sha256Bytes(archived) !== inputs[path] ||
                sha256ContainedRegularFile(paths.buildInputs, adjacent) !== inputs[path]
            ) {
                errors.push(`Electron FFmpeg build input ${path} does not match the source archive`);
            }
        }
    }
    return inputs;
}

function validateDesktop(
    root: string,
    candidate: string,
    proof: JsonRecord,
    expectedRevision: string,
    errors: string[],
    runtimeContract: ElectronRuntimeContract,
    releaseInventory: ReleaseInventory,
    snapshotRoot: string,
    snapshotBudget: CandidateSnapshotBudget,
    fileReader: ReleaseProofFileReader
): Record<string, string> | undefined {
    const desktop = requiredRecord(proof, 'desktop', 'release proof', errors);
    if (desktop === undefined) {
        return undefined;
    }
    if (desktop.platform !== 'darwin' || desktop.arch !== 'arm64') {
        errors.push('desktop proof must target darwin arm64');
    }
    let expectedArtifactName: string | undefined;
    try {
        expectedArtifactName = expectedDesktopArtifactName(root);
    } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
    }
    const canonicalPaths = [
        [desktop.artifactPath, expectedArtifactName === undefined ? undefined : `desktop/${expectedArtifactName}`],
        [desktop.contentsManifestPath, 'desktop/desktop-contents-manifest.json'],
        [desktop.runtimeManifestPath, 'desktop/ELECTRON-SOURCES.json'],
        [desktop.electronSourcePath, `desktop/electron-${runtimeContract.revision}.tar.gz`],
        [desktop.electronCommitPath, `desktop/electron-${runtimeContract.revision}.commit`],
        [desktop.ffmpegSourcePath, `desktop/ffmpeg-${runtimeContract.ffmpeg.revision}.tar.gz`],
        [desktop.ffmpegCommitPath, `desktop/ffmpeg-${runtimeContract.ffmpeg.revision}.commit`],
        [desktop.ffmpegBuildPath, 'desktop/ffmpeg-build-material.json'],
        [desktop.buildInputsPath, 'desktop/build-inputs/electron'],
    ] as const;
    for (const [actual, expected] of canonicalPaths) {
        if (expected !== undefined && actual !== expected) {
            errors.push(`desktop material path must be ${expected}`);
        }
    }
    const artifactPath = verifyFileHash(
        candidate,
        desktop.artifactPath,
        desktop.artifactSha256,
        'desktop artifact',
        RELEASE_PROOF_ARCHIVE_LIMITS.candidateFileBytes,
        errors,
        snapshotRoot,
        snapshotBudget,
        fileReader
    );
    if (artifactPath !== undefined && basename(artifactPath.candidatePath) !== expectedArtifactName) {
        errors.push('desktop artifact must preserve the exact Sourdaw version-arm64-mac ZIP filename');
    }
    const contentsManifestPath = verifyFileHash(
        candidate,
        desktop.contentsManifestPath,
        desktop.contentsManifestSha256,
        'desktop contents manifest',
        RELEASE_PROOF_TYPE_LIMITS.jsonBytes,
        errors,
        snapshotRoot,
        snapshotBudget,
        fileReader
    );
    const runtimeManifestPath = verifyFileHash(
        candidate,
        desktop.runtimeManifestPath,
        desktop.runtimeManifestSha256,
        'desktop runtime manifest',
        RELEASE_PROOF_TYPE_LIMITS.jsonBytes,
        errors,
        snapshotRoot,
        snapshotBudget,
        fileReader
    );
    const electronArchive = verifyFileHash(
        candidate,
        desktop.electronSourcePath,
        desktop.electronSourceSha256,
        'Electron source archive',
        RELEASE_PROOF_ARCHIVE_LIMITS.candidateFileBytes,
        errors,
        snapshotRoot,
        snapshotBudget,
        fileReader
    );
    const electronCommit = verifyFileHash(
        candidate,
        desktop.electronCommitPath,
        desktop.electronCommitSha256,
        'Electron commit object',
        RELEASE_PROOF_TYPE_LIMITS.commitObjectBytes,
        errors,
        snapshotRoot,
        snapshotBudget,
        fileReader
    );
    const ffmpegArchive = verifyFileHash(
        candidate,
        desktop.ffmpegSourcePath,
        desktop.ffmpegSourceSha256,
        'FFmpeg source archive',
        RELEASE_PROOF_ARCHIVE_LIMITS.candidateFileBytes,
        errors,
        snapshotRoot,
        snapshotBudget,
        fileReader
    );
    const ffmpegCommit = verifyFileHash(
        candidate,
        desktop.ffmpegCommitPath,
        desktop.ffmpegCommitSha256,
        'FFmpeg commit object',
        RELEASE_PROOF_TYPE_LIMITS.commitObjectBytes,
        errors,
        snapshotRoot,
        snapshotBudget,
        fileReader
    );
    const buildManifest = verifyFileHash(
        candidate,
        desktop.ffmpegBuildPath,
        desktop.ffmpegBuildSha256,
        'FFmpeg build material',
        RELEASE_PROOF_TYPE_LIMITS.jsonBytes,
        errors,
        snapshotRoot,
        snapshotBudget,
        fileReader
    );
    const buildInputs = candidatePath(candidate, desktop.buildInputsPath, 'desktop.buildInputsPath', errors);
    const manifest =
        contentsManifestPath === undefined
            ? undefined
            : readJsonForValidation(
                  snapshotRoot,
                  contentsManifestPath.snapshotPath,
                  'desktop contents manifest',
                  errors
              );
    if (manifest !== undefined) {
        if (manifest.sourceRevision !== expectedRevision) {
            errors.push('desktop contents manifest revision does not match candidate revision');
        }
        if (artifactPath !== undefined) {
            validateDesktopArchiveContents(
                root,
                artifactPath.snapshotPath,
                desktop.artifactSha256,
                manifest,
                runtimeContract,
                errors,
                releaseInventory
            );
        }
    }
    const expectedRuntime = readJsonForValidation(
        root,
        resolve(root, 'public/legal/ELECTRON-SOURCES.json'),
        'repository Electron manifest',
        errors
    );
    const actualRuntime =
        runtimeManifestPath === undefined
            ? undefined
            : readJsonForValidation(snapshotRoot, runtimeManifestPath.snapshotPath, 'desktop runtime manifest', errors);
    if (
        expectedRuntime !== undefined &&
        actualRuntime !== undefined &&
        (!sameValue(actualRuntime, expectedRuntime) || !sameValue(actualRuntime, runtimeContract))
    ) {
        errors.push('desktop runtime manifest does not match repository provenance');
    }
    const material = readJsonForValidation(
        root,
        resolve(root, 'release/desktop-runtime-material.json'),
        'desktop material contract',
        errors
    );
    if (material !== undefined && !sameValue(material, expectedDesktopMaterial(runtimeContract))) {
        errors.push('desktop material contract identity drifted');
    }
    return validateBuildMaterial(
        snapshotRoot,
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

function validateCandidateCensus(
    candidate: string,
    proof: JsonRecord,
    maps: CandidateCensusMaps,
    errors: string[]
): void {
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
    if (webContents !== undefined && maps.webFiles !== undefined) {
        for (const path of Object.keys(maps.webFiles)) {
            expected.add(posix.join(webContents, path));
        }
    }

    const buildInputs = safeRelativePath(desktop?.buildInputsPath, 'desktop.buildInputsPath', errors);
    if (buildInputs !== undefined && maps.buildInputs !== undefined) {
        for (const path of Object.keys(maps.buildInputs)) {
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
    let releaseInventory: ReleaseInventory | undefined;
    try {
        releaseInventory =
            options.releaseInventory ?? (options.releaseInventoryReader ?? readReleaseInventory)(options.root);
    } catch (error) {
        errors.push(error instanceof Error ? error.message : 'release inventory cannot be read safely');
    }
    if (!/^[0-9a-f]{40}$/u.test(options.expectedRevision)) {
        errors.push('expected revision must be a 40-character Git SHA');
    }
    try {
        if (gitRevision(options.root) !== options.expectedRevision) {
            errors.push('release proof validation checkout HEAD does not match the expected revision');
        }
        const status = execFileSync('git', ['status', '--porcelain'], { cwd: options.root, encoding: 'utf8' });
        if (status.trim() !== '') {
            errors.push('release proof validation requires a clean worktree');
        }
    } catch {
        errors.push('release proof validation checkout identity could not be verified');
    }
    if (!existsSync(options.candidate) || !lstatSync(options.candidate).isDirectory()) {
        errors.push('release proof candidate directory is missing');
        return errors;
    }
    const proofPath = resolve(options.candidate, PROOF_FILE);
    if (
        !existsSync(proofPath) ||
        !lstatSync(proofPath).isFile() ||
        containedRealPath(options.candidate, proofPath, PROOF_FILE, errors) === undefined
    ) {
        errors.push(`${PROOF_FILE}: file is missing or unsafe`);
        return errors;
    }
    const proof = readJsonForValidation(options.candidate, proofPath, PROOF_FILE, errors);
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
    const snapshotRoot = mkdtempSync(join(tmpdir(), 'sourdaw-release-proof-snapshot-'));
    try {
        const fileReader = options.fileReader ?? releaseProofFileReader;
        const snapshotBudget = candidateSnapshotBudget(fileReader);
        validateSourceManifest(
            options.candidate,
            proof,
            options.expectedRevision,
            errors,
            snapshotRoot,
            snapshotBudget,
            fileReader
        );
        let webFiles: Record<string, string> | undefined;
        let buildInputs: Record<string, string> | undefined;
        if (releaseInventory !== undefined) {
            webFiles = validateWebManifest(
                options.root,
                options.candidate,
                proof,
                options.expectedRevision,
                errors,
                releaseInventory,
                snapshotRoot,
                snapshotBudget,
                fileReader
            );
            buildInputs = validateDesktop(
                options.root,
                options.candidate,
                proof,
                options.expectedRevision,
                errors,
                runtimeContract,
                releaseInventory,
                snapshotRoot,
                snapshotBudget,
                fileReader
            );
        }
        validateCandidateCensus(options.candidate, proof, { buildInputs, webFiles }, errors);
        return errors;
    } finally {
        rmSync(snapshotRoot, { recursive: true, force: true });
    }
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
        commitObject = execFileSync('git', ['cat-file', 'commit', revision], {
            cwd: checkout,
            maxBuffer: RELEASE_PROOF_TYPE_LIMITS.commitObjectBytes,
        });
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
        return execFileSync('git', ['show', `${revision}:${path}`], {
            cwd: checkout,
            maxBuffer: RELEASE_PROOF_TYPE_LIMITS.buildInputBytes,
        });
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
    const directories = [root];
    while (directories.length > 0) {
        const directory = directories.pop();
        if (directory === undefined) {
            break;
        }
        for (const entry of readdirSync(directory, { withFileTypes: true })) {
            const child = join(directory, entry.name);
            if (entry.isDirectory()) {
                chmodSync(child, 0o755);
                directories.push(child);
            } else if (entry.isFile()) {
                chmodSync(child, 0o644);
                files.push(child);
            }
        }
    }
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
    const status = execFileSync('git', ['status', '--porcelain'], {
        cwd: root,
        encoding: 'utf8',
    });
    if (status.trim() !== '') {
        throw new Error('release build changed source files');
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
    if (!existsSync(directory) || !lstatSync(directory).isDirectory()) {
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
    if (artifactName !== expectedDesktopArtifactName(root)) {
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
    buildRunner: ReleaseBuildRunner = runProjectBuild,
    releaseGate: ReleaseGateRunner = (gateRoot, releaseInventory) =>
        checkReleaseInventory(gateRoot, undefined, releaseInventory),
    inventoryReader: ReleaseInventoryReader = readReleaseInventory,
    validator: ReleaseProofValidator = validateReleaseProof
): void {
    assertClean(root);
    const revision = gitRevision(root);
    const releaseInventory = inventoryReader(root);
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
        if (!existsSync(webDist) || !lstatSync(webDist).isDirectory()) {
            throw new Error('web build produced no dist directory');
        }
        const webBuildFiles = fileMap(webDist);
        copyDirectory(webDist, webContents);
        if (!sameValue(fileMap(webContents), webBuildFiles)) {
            throw new Error('copied web contents do not match the exact web build dist');
        }
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
        const desktopDist = resolve(root, 'dist');
        if (!existsSync(desktopDist) || !lstatSync(desktopDist).isDirectory()) {
            throw new Error('desktop build produced no renderer dist directory');
        }
        const rendererFiles = rendererFileMap(desktopDist);
        const desktopArtifact = selectDesktopArtifact(root);
        const artifactName = basename(desktopArtifact);
        const desktopArtifactOut = join(desktopDir, artifactName);
        cpSync(desktopArtifact, desktopArtifactOut);
        const desktop = desktopSnapshot(desktopArtifactOut);
        if (!sameValue(desktop.rendererFiles, rendererFiles)) {
            throw new Error('packaged app.asar renderer does not match the exact desktop build dist');
        }
        const runtimeFfmpeg = resolve(root, ...ELECTRON_RUNTIME_FFMPEG.split('/'));
        const runtimeFfmpegError = machOError(runtimeFfmpeg, MH_DYLIB);
        if (runtimeFfmpegError !== undefined) {
            throw new Error(`installed Electron runtime libffmpeg.dylib is invalid: ${runtimeFfmpegError}`);
        }
        const runtimeFfmpegSha256 = sha256File(runtimeFfmpeg);
        if (runtimeFfmpegSha256 !== desktop.ffmpegSha256) {
            throw new Error(
                'packaged libffmpeg.dylib does not match the installed Electron runtime used by desktop:build'
            );
        }
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
            asarPath: DESKTOP_ASAR,
            packagedFfmpegPath: DESKTOP_FFMPEG,
            packagedFfmpegSha256: desktop.ffmpegSha256,
            buildReceipt: {
                command: 'pnpm desktop:build',
                sourceRevision: revision,
                rendererOutput: 'dist',
                rendererFiles,
                fuses: requiredFuseClaims(),
                electronRuntime: {
                    revision: runtimeContract.revision,
                    ffmpegPath: ELECTRON_RUNTIME_FFMPEG,
                    ffmpegSha256: runtimeFfmpegSha256,
                },
            },
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
        const errors = validator({
            root,
            candidate,
            expectedRevision: revision,
            runtimeContract,
            releaseInventory,
        });
        if (errors.length > 0) {
            throw new Error(errors.join('\n'));
        }
        assertBuildState(root, revision);
        releaseGate(root, releaseInventory);
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
