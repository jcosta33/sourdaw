import { createHash } from 'node:crypto';
import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync, readSync, realpathSync } from 'node:fs';
import { posix, resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';

import { Parser, type ReadEntry } from 'tar';

import { parseJsonWithUniqueKeys } from './strictJson.ts';

export const FAUST_SOURCE_ARCHIVE = 'public/legal/faustwasm-0.20.2-corresponding-source.tar.gz';
export const FAUST_SOURCE_SHA256 = '7a6f0939e8905e40b7733f8e17cf5c806f3c89fb6c5291985dcc6deb883b3682';
const ARCHIVE_BYTES = 854364;
const ROOT = 'faustwasm-0.20.2-source/';
const LIBRARY_REVISION = '42fab480c778df7bad5c6b620ca4fd005b2bfe9b';
const EXECUTABLES = {
    esbuild: '0.28.2',
    main: { sha256: 'aab25a0e405586b6ce614788f2edc473d7241d523f2a61fbf020ada14655ff1a', bytes: 357915 },
    worklets: {
        monoProcessorSource: {
            sha256: '1e55ff97f7235bc37a0d469873e2fddafecb858e15e391e1bab628243acb3a68',
            bytes: 41007,
        },
        polyProcessorSource: {
            sha256: '0925b823c1b1b99f99eb8d2c4d24578d68393bac2cee55a55b207e4d4c168752',
            bytes: 49606,
        },
        fftProcessorSource: {
            sha256: '154bfce637d08466933b4842f91140e8e3c47ec3bdbe1bd92b288636e794395e',
            bytes: 43078,
        },
    },
};

function hash(bytes: Buffer): string {
    return createHash('sha256').update(bytes).digest('hex');
}

/** Read only: never extract executable source into the checkout or follow archive links. */
export function readFaustSourceArchive(bytes: Buffer): Map<string, Buffer> {
    if (bytes.length > 1024 * 1024) {
        throw new Error('corresponding source archive exceeds compressed limit');
    }
    const raw = gunzipSync(bytes, { maxOutputLength: 8 * 1024 * 1024 });
    const files = new Map<string, Buffer>();
    let failure: Error | undefined;
    const parser = new Parser({ strict: true, maxMetaEntrySize: 16384 });
    parser.on('error', (error: Error) => {
        failure = error;
    });
    parser.on('entry', (entry: ReadEntry) => {
        const name = entry.path.slice(ROOT.length);
        if (
            !entry.path.startsWith(ROOT) ||
            !name ||
            name.includes('\\') ||
            posix.isAbsolute(name) ||
            posix.normalize(name) !== name ||
            name.split('/').includes('..') ||
            name.includes('\0')
        ) {
            failure = new Error('corresponding source archive has a noncanonical member');
        } else if (entry.type !== 'File' && entry.type !== 'OldFile') {
            failure = new Error('corresponding source archive has a nonregular member');
        } else if (files.has(name)) {
            failure = new Error('corresponding source archive repeats a member');
        } else if (entry.size > 2 * 1024 * 1024 || files.size >= 256) {
            failure = new Error('corresponding source archive exceeds member limit');
        }
        const chunks: Buffer[] = [];
        entry.on('data', (chunk: Buffer) => {
            if (!failure) {
                chunks.push(chunk);
            }
        });
        entry.on('end', () => {
            if (!failure) {
                files.set(name, Buffer.concat(chunks));
            }
        });
        entry.resume();
    });
    parser.end(raw);
    if (failure) {
        throw failure;
    }
    if (files.size === 0) {
        throw new Error('corresponding source archive is empty');
    }
    return files;
}

function json<Value>(files: Map<string, Buffer>, name: string): Value {
    const bytes = files.get(name);
    if (!bytes) {
        throw new Error(`corresponding source lacks ${name}`);
    }
    return parseJsonWithUniqueKeys<Value>(bytes.toString('utf8'), name);
}

export function assertFaustSourceContents(files: Map<string, Buffer>): void {
    const manifest = json<{ schemaVersion: number; files: Record<string, { sha256: string; bytes: number }> }>(
        files,
        'SOURCE-MANIFEST.json'
    );
    if (manifest.schemaVersion !== 1 || !manifest.files || Object.keys(manifest.files).length !== files.size - 1) {
        throw new Error('corresponding source manifest census drifted');
    }
    for (const [name, expected] of Object.entries(manifest.files)) {
        const bytes = files.get(name);
        if (!bytes || hash(bytes) !== expected.sha256 || bytes.length !== expected.bytes) {
            throw new Error(`corresponding source input drifted: ${name}`);
        }
    }
    for (const name of [
        'COPYING.txt',
        'README.md',
        'src/FaustDspGenerator.ts',
        'src/FaustAudioWorkletProcessor.ts',
        'src/FaustFFTAudioWorkletProcessor.ts',
        'src/FaustWebAudioDsp.ts',
        'src/worklet/mono.ts',
        'src/worklet/poly.ts',
        'src/worklet/fft.ts',
        'build-worklets.js',
        'build.mjs',
        'provision.mjs',
        'package-lock.json',
    ]) {
        if (!files.get(name)?.length) {
            throw new Error(`corresponding source lacks ${name}`);
        }
    }
    const expected = json<typeof EXECUTABLES>(files, 'provenance/expected-executables.json');
    if (JSON.stringify(expected) !== JSON.stringify(EXECUTABLES)) {
        throw new Error('corresponding source executable identities drifted');
    }
    const upstream = json<{ name: string; version: string; license: string }>(
        files,
        'provenance/upstream-package.json'
    );
    if (upstream.name !== '@grame/faustwasm' || upstream.version !== '0.20.2' || upstream.license !== 'LGPL-2.1') {
        throw new Error('corresponding source package identity drifted');
    }
}

function assertInstalledWorklets(content: string): void {
    const records = [...content.matchAll(/^export const (\w+) = (.*);$/gmu)];
    if (records.length !== 3) {
        throw new Error('installed generated worklets malformed');
    }
    for (const record of records) {
        const expected = EXECUTABLES.worklets[record[1] as keyof typeof EXECUTABLES.worklets];
        const text: unknown = JSON.parse(record[2]!);
        if (
            !expected ||
            typeof text !== 'string' ||
            hash(Buffer.from(text)) !== expected.sha256 ||
            Buffer.byteLength(text) !== expected.bytes
        ) {
            throw new Error('installed worklet does not match reconstructed executable');
        }
    }
}

function assertInstalledWrapper(files: Map<string, Buffer>, packageRoot: string): void {
    const main = readFileSync(resolve(packageRoot, 'dist/esm/index.js'));
    if (hash(main) !== EXECUTABLES.main.sha256 || main.length !== EXECUTABLES.main.bytes) {
        throw new Error('installed wrapper does not match reconstructed executable');
    }
    const map = JSON.parse(readFileSync(resolve(packageRoot, 'dist/esm/index.js.map'), 'utf8')) as {
        sources: string[];
        sourcesContent: string[];
    };
    if (map.sources.length !== 27 || map.sourcesContent.length !== 27) {
        throw new Error('installed wrapper source map census drifted');
    }
    for (let index = 0; index < map.sources.length; index++) {
        const source = map.sources[index]!;
        const content = map.sourcesContent[index];
        if (typeof content !== 'string' || !source.startsWith('../../')) {
            throw new Error('installed wrapper source map malformed');
        }
        const name = source.slice(6);
        if (name === 'src/generated/workletSources.ts') {
            assertInstalledWorklets(content);
            continue;
        }
        const capsulePath = name.startsWith('node_modules/') ? `preferred-dependency-sources/${name.slice(13)}` : name;
        if (!files.get(capsulePath)?.equals(Buffer.from(content))) {
            throw new Error(`installed preferred source differs: ${name}`);
        }
    }
}

function assertInstalledLibraries(files: Map<string, Buffer>, packageRoot: string): void {
    const library = json<{
        libraryRevision: string;
        libraries: { path: string; sourcePath: string; start: number; end: number; sha256: string }[];
    }>(files, 'provenance/library-source-match.json');
    if (library.libraryRevision !== LIBRARY_REVISION || library.libraries.length !== 55) {
        throw new Error('compiler library source census drifted');
    }
    const data = readFileSync(resolve(packageRoot, 'libfaust-wasm/libfaust-wasm.data'));
    const js = readFileSync(resolve(packageRoot, 'libfaust-wasm/libfaust-wasm.js'), 'utf8');
    const bundled = [...js.matchAll(/filename:"([^"]+\.lib)",start:(\d+),end:(\d+)/gu)];
    if (bundled.length !== 55) {
        throw new Error('installed compiler library census drifted');
    }
    for (const [path, start, end] of bundled.map(
        (record) => [record[1]!.replace('/usr/share/faust/', ''), Number(record[2]), Number(record[3])] as const
    )) {
        const record = library.libraries.find((candidate) => candidate.path === path);
        if (!record || record.start !== start || record.end !== end || start < 0 || end > data.length || end <= start) {
            throw new Error('installed compiler library offsets drifted');
        }
        const source = files.get(`faustlibraries/${record.sourcePath}`);
        if (!source || hash(source) !== record.sha256 || !source.equals(data.subarray(start, end))) {
            throw new Error(`compiler library source differs: ${path}`);
        }
    }
}

function openFaustSourceArchive(path: string): number | string {
    try {
        return openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
    } catch (error) {
        if (error instanceof Error && 'code' in error) {
            if (error.code === 'ENOENT' || error.code === 'ENOTDIR') {
                return 'corresponding source archive missing';
            }
            if (error.code === 'ELOOP' || error.code === 'EISDIR') {
                return 'corresponding source archive is not a contained regular file';
            }
        }
        throw error;
    }
}

function readBoundedFaustSourceArchive(descriptor: number): Buffer {
    // One extra byte detects growth without reading an unbounded replacement or append.
    const buffer = Buffer.alloc(ARCHIVE_BYTES + 1);
    let offset = 0;
    while (offset < buffer.length) {
        const count = readSync(descriptor, buffer, offset, buffer.length - offset, offset);
        if (count === 0) {
            break;
        }
        offset += count;
    }
    return buffer.subarray(0, offset);
}

/** The reviewed immutable capsule and installed package hashes, not caller JSON, authorize these source bytes. */
export function validateFaustCorrespondingSource(root: string): string[] {
    const path = resolve(root, FAUST_SOURCE_ARCHIVE);
    const descriptor = openFaustSourceArchive(path);
    if (typeof descriptor === 'string') {
        return [`faustwasm: ${descriptor}`];
    }
    let bytes: Buffer;
    try {
        const stat = fstatSync(descriptor);
        const current = lstatSync(path);
        if (
            !stat.isFile() ||
            !current.isFile() ||
            current.dev !== stat.dev ||
            current.ino !== stat.ino ||
            realpathSync(path) !== resolve(realpathSync(root), FAUST_SOURCE_ARCHIVE)
        ) {
            return ['faustwasm: corresponding source archive is not a contained regular file'];
        }
        if (stat.size !== ARCHIVE_BYTES) {
            return ['faustwasm: corresponding source archive digest drifted'];
        }
        bytes = readBoundedFaustSourceArchive(descriptor);
    } finally {
        closeSync(descriptor);
    }
    if (bytes.length !== ARCHIVE_BYTES || hash(bytes) !== FAUST_SOURCE_SHA256) {
        return ['faustwasm: corresponding source archive digest drifted'];
    }
    try {
        const files = readFaustSourceArchive(bytes);
        assertFaustSourceContents(files);
        const packageRoot = resolve(root, 'node_modules/@grame/faustwasm');
        assertInstalledWrapper(files, packageRoot);
        assertInstalledLibraries(files, packageRoot);
        return [];
    } catch (error) {
        return [`faustwasm: ${error instanceof Error ? error.message : String(error)}`];
    }
}
