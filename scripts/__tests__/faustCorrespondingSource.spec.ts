import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';

import { Header } from 'tar';
import { afterEach, describe, expect, it } from 'vitest';

import {
    assertFaustSourceContents,
    FAUST_SOURCE_ARCHIVE,
    FAUST_SOURCE_SHA256,
    readFaustSourceArchive,
    validateFaustCorrespondingSource,
} from '../faustCorrespondingSource';

const archive = readFileSync(resolve(FAUST_SOURCE_ARCHIVE));
const roots: string[] = [];
const prefix = 'faustwasm-0.20.2-source/';

function member(path: string, type: 'File' | 'SymbolicLink' = 'File'): Buffer {
    const header = Buffer.alloc(512);
    new Header({ path, type, linkpath: type === 'SymbolicLink' ? '/outside' : undefined, size: 1, mode: 0o644 }).encode(
        header
    );
    return Buffer.concat([header, Buffer.from('x'), Buffer.alloc(511)]);
}

function packed(...members: Buffer[]): Buffer {
    return gzipSync(Buffer.concat([...members, Buffer.alloc(1024)]));
}

function fixture(): string {
    const root = mkdtempSync(join(tmpdir(), 'faust-source-'));
    roots.push(root);
    const target = join(root, FAUST_SOURCE_ARCHIVE);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, archive);
    for (const name of [
        'dist/esm/index.js',
        'dist/esm/index.js.map',
        'libfaust-wasm/libfaust-wasm.js',
        'libfaust-wasm/libfaust-wasm.data',
    ]) {
        const target = join(root, 'node_modules/@grame/faustwasm', name);
        mkdirSync(dirname(target), { recursive: true });
        copyFileSync(resolve('node_modules/@grame/faustwasm', name), target);
    }
    return root;
}

afterEach(() => {
    for (const root of roots.splice(0)) {
        rmSync(root, { recursive: true, force: true });
    }
});

describe('Faust corresponding-source capsule', () => {
    it('binds editable source, all55 libraries and rebuilt executable identities to the installed package', () => {
        expect(createHash('sha256').update(archive).digest('hex')).toBe(FAUST_SOURCE_SHA256);
        const files = readFaustSourceArchive(archive);
        expect(files.size).toBe(128);
        expect(() => assertFaustSourceContents(files)).not.toThrow();
        expect(validateFaustCorrespondingSource(process.cwd())).toEqual([]);
    });

    it.each(['../escape', '/absolute', 'nested/../alias', 'nested\\alias', './alias'])(
        'rejects noncanonical archive member %s',
        (name) => {
            expect(() => readFaustSourceArchive(packed(member(`${prefix}${name}`)))).toThrow('noncanonical');
        }
    );

    it('rejects duplicate effective members', () => {
        expect(() => readFaustSourceArchive(packed(member(`${prefix}same`), member(`${prefix}same`)))).toThrow(
            'repeats'
        );
    });

    it('rejects archive links without extracting or following them', () => {
        expect(() => readFaustSourceArchive(packed(member(`${prefix}link`, 'SymbolicLink')))).toThrow('nonregular');
    });

    it('bounds decompression before parsing members', () => {
        expect(() => readFaustSourceArchive(gzipSync(Buffer.alloc(9 * 1024 * 1024)))).toThrow();
    });

    it('rejects incomplete editable source even after a caller rewrites its manifest', () => {
        const files = readFaustSourceArchive(archive);
        const manifest = JSON.parse(files.get('SOURCE-MANIFEST.json')!.toString()) as {
            files: Record<string, unknown>;
        };
        files.delete('src/worklet/poly.ts');
        delete manifest.files['src/worklet/poly.ts'];
        files.set('SOURCE-MANIFEST.json', Buffer.from(JSON.stringify(manifest)));
        expect(() => assertFaustSourceContents(files)).toThrow('lacks src/worklet/poly.ts');
    });

    it('rejects caller-authored executable expectations even with matching manifest hashes', () => {
        const files = readFaustSourceArchive(archive);
        const name = 'provenance/expected-executables.json';
        const bytes = Buffer.from('{}');
        const manifest = JSON.parse(files.get('SOURCE-MANIFEST.json')!.toString()) as {
            files: Record<string, { sha256: string; bytes: number }>;
        };
        files.set(name, bytes);
        manifest.files[name] = { sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length };
        files.set('SOURCE-MANIFEST.json', Buffer.from(JSON.stringify(manifest)));
        expect(() => assertFaustSourceContents(files)).toThrow('executable identities drifted');
    });

    it('rejects an installed wrapper substituted after the capsule was proved', () => {
        const root = fixture();
        writeFileSync(join(root, 'node_modules/@grame/faustwasm/dist/esm/index.js'), 'different executable');
        expect(validateFaustCorrespondingSource(root)).toContain(
            'faustwasm: installed wrapper does not match reconstructed executable'
        );
    });

    it('rejects a substituted preferred source in the installed wrapper map', () => {
        const root = fixture();
        const path = join(root, 'node_modules/@grame/faustwasm/dist/esm/index.js.map');
        const map = JSON.parse(readFileSync(path, 'utf8')) as { sourcesContent: string[] };
        map.sourcesContent[0] = 'unrelated source';
        writeFileSync(path, JSON.stringify(map));
        expect(validateFaustCorrespondingSource(root)).toContain(
            'faustwasm: installed preferred source differs: src/instantiateFaustModuleFromFile.ts'
        );
    });

    it('rejects a capsule symlink outside the project', () => {
        const root = fixture();
        const path = join(root, FAUST_SOURCE_ARCHIVE);
        rmSync(path);
        symlinkSync(resolve(FAUST_SOURCE_ARCHIVE), path);
        expect(validateFaustCorrespondingSource(root)).toContain(
            'faustwasm: corresponding source archive is not a contained regular file'
        );
    });
});
