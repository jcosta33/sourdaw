import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { change, ImmutableString, init, load, save } from '@automerge/automerge';
import { describe, expect, it } from 'vitest';

import { decodeSdawFile } from '../decodeSdawFile';
import { encodeSdawFile } from '../encodeSdawFile';

import type { DocumentBundle } from '../../../models/CrdtDocumentTypes';

/**
 * Golden-fixture conformance between the two independent `.sdaw` codecs:
 * `encodeSdawFile` / `decodeSdawFile` here, and `encode_sdaw` / `decode_sdaw` in
 * `crates/daw-collab/src/persistence.rs`. The fixtures under `tests/fixtures/sdaw/`
 * are the artifact — each language decodes bytes the *other* language produced, so
 * neither side can drift without the other going red.
 *
 * The canonical bundles below are mirrored exactly in the Rust conformance module.
 * Change one and you must change both.
 */

/**
 * Anchored on `process.cwd()`, matching `reverbDecayLawRustParity.spec.ts`.
 *
 * That is safe here rather than merely conventional: this repo's vitest cannot be
 * invoked from a subdirectory at all — it resolves `./package.json` against the
 * working directory and exits with `ENOENT` before collecting any test — so
 * `process.cwd()` is always the repo root when this file runs. Resolving from
 * `import.meta.url` instead is *not* an available alternative: under the Vite
 * transform it is not a `file:` URL, and `fileURLToPath` throws on it.
 */
const FIXTURE_DIR = 'tests/fixtures/sdaw';

function fixturePath(name: string): string {
    return resolve(process.cwd(), FIXTURE_DIR, name);
}

function readFixture(name: string): Uint8Array {
    return new Uint8Array(readFileSync(fixturePath(name)));
}

function canonicalEmpty(): DocumentBundle {
    return new Map();
}

function canonicalSingle(): DocumentBundle {
    return new Map([['root', Uint8Array.from([1, 2, 3, 4])]]);
}

/**
 * Four documents inserted in arrangement order, which is deliberately *not*
 * alphabetical order, and whose framed record sizes are all distinct (16, 20, 22
 * and 19 bytes).
 *
 * Both properties matter. The Rust generator emits records sorted by DocId, so the
 * non-alphabetical insertion order here keeps `ts-written-multi.sdaw` and
 * `rust-written-multi.sdaw` genuinely different files — each side is reading bytes
 * it could not have produced itself. The distinct record sizes mean a total-length
 * comparison cannot be fooled by a duplicated record standing in for a dropped one.
 */
function canonicalMulti(): DocumentBundle {
    return new Map([
        ['root', Uint8Array.from([1, 2, 3, 4])],
        ['track_kick', Uint8Array.from([5, 6])],
        ['track_snare', Uint8Array.from([7, 8, 9])],
        ['track_bass', Uint8Array.from([10])],
    ]);
}

/**
 * Build an Automerge document reproducibly.
 *
 * The actor id and the commit timestamp are both pinned. Left to their defaults
 * they are a random actor and `Date.now()`, which makes every regenerated fixture a
 * different file and leaves a reviewer unable to verify a checked-in artifact by
 * regenerating it.
 */
function automergeDoc(actor: string, fields: Record<string, string>): Uint8Array {
    const doc = change(init<Record<string, string>>(actor), { time: 0 }, (draft) => {
        for (const [key, value] of Object.entries(fields)) {
            draft[key] = value;
        }
    });
    return save(doc);
}

function canonicalAutomerge(): DocumentBundle {
    return new Map([
        ['root', automergeDoc('00000000000000000000000000000011', { name: 'conformance', kind: 'root' })],
        ['track_a', automergeDoc('00000000000000000000000000000012', { label: 'alpha' })],
    ]);
}

/**
 * Read a root-level string out of a loaded document, narrowing on shape rather
 * than coercing.
 *
 * A string this binding authored reads back as a primitive. One the Rust binding
 * authored (a `Str` scalar) reads back as an `ImmutableString` — `typeof` is
 * `'object'`, and `value === 'alpha'` is **false**. A cross-language reader has to
 * accept both, so this narrows explicitly. It deliberately does not call
 * `String(value)`: that would also swallow a number, or turn a missing key into
 * `'undefined'`, neutralising the very divergence being documented.
 *
 * That asymmetry lives in Automerge's bindings, not in the `.sdaw` container these
 * tests conform — but it does reach production. See the commit body.
 */
function readString(doc: Record<string, unknown>, key: string): string {
    const value = doc[key];
    if (typeof value === 'string') {
        return value;
    }
    if (value instanceof ImmutableString) {
        return value.val;
    }
    throw new Error(`expected "${key}" to be a string or ImmutableString, got ${typeof value}`);
}

function payloadOf(bundle: DocumentBundle, docId: string): Uint8Array {
    const payload = bundle.get(docId);
    if (payload === undefined) {
        throw new Error(`fixture is missing document "${docId}"`);
    }
    return payload;
}

describe('.sdaw conformance: fixtures written by the Rust codec, decoded by TypeScript', () => {
    it('decodes the Rust-written empty bundle to zero documents', () => {
        expect(decodeSdawFile(readFixture('rust-written-empty.sdaw')).size).toBe(0);
    });

    it('encodes an empty bundle to the exact bytes Rust wrote', () => {
        expect(encodeSdawFile(canonicalEmpty())).toEqual(readFixture('rust-written-empty.sdaw'));
    });

    it('decodes the Rust-written single-document bundle to the canonical payload', () => {
        const decoded = decodeSdawFile(readFixture('rust-written-single.sdaw'));
        expect([...decoded.keys()]).toEqual(['root']);
        expect(payloadOf(decoded, 'root')).toEqual(Uint8Array.from([1, 2, 3, 4]));
    });

    it('encodes the single-document bundle to the exact bytes Rust wrote', () => {
        expect(encodeSdawFile(canonicalSingle())).toEqual(readFixture('rust-written-single.sdaw'));
    });

    it('decodes every document of the Rust-written multi-document bundle', () => {
        const decoded = decodeSdawFile(readFixture('rust-written-multi.sdaw'));
        expect([...decoded.keys()]).toEqual(['root', 'track_bass', 'track_kick', 'track_snare']);
        expect(payloadOf(decoded, 'root')).toEqual(Uint8Array.from([1, 2, 3, 4]));
        expect(payloadOf(decoded, 'track_kick')).toEqual(Uint8Array.from([5, 6]));
        expect(payloadOf(decoded, 'track_snare')).toEqual(Uint8Array.from([7, 8, 9]));
        expect(payloadOf(decoded, 'track_bass')).toEqual(Uint8Array.from([10]));
    });

    it('re-encodes the Rust-written multi-document bundle to byte-identical output', () => {
        // This is the byte-for-byte multi-document check, and it lives here because
        // only this side can carry it: given Rust's record order, this encoder
        // reproduces Rust's file exactly. `encode_sdaw` cannot mirror it — it iterates
        // a `HashMap`, so its record order is a per-process random permutation. The
        // Rust side asserts the order-independent equivalent (the multiset of raw
        // record bytes) in `encodes_the_canonical_multi_document_bundle_to_the_same_
        // records_typescript_wrote`.
        const bytes = readFixture('rust-written-multi.sdaw');
        expect(encodeSdawFile(decodeSdawFile(bytes))).toEqual(bytes);
    });

    it('orders the Rust-written multi-document fixture differently from the TypeScript one', () => {
        // Guards the non-circularity of this whole file. The Rust generator sorts by
        // DocId; this encoder emits Map insertion order. If these two ever became the
        // same bytes, every assertion above could be satisfied by a fixture this
        // language produced itself.
        const rustBytes = readFixture('rust-written-multi.sdaw');
        const tsBytes = readFixture('ts-written-multi.sdaw');
        const rustKeys = [...decodeSdawFile(rustBytes).keys()];
        const tsKeys = [...decodeSdawFile(tsBytes).keys()];

        expect(rustKeys).toEqual(['root', 'track_bass', 'track_kick', 'track_snare']);
        expect(tsKeys).toEqual(['root', 'track_kick', 'track_snare', 'track_bass']);
        expect(rustBytes).not.toEqual(tsBytes);
        expect(rustBytes.length).toBe(tsBytes.length);
    });

    it('loads the Automerge documents Rust wrote and reads their fields', () => {
        const decoded = decodeSdawFile(readFixture('rust-written-automerge.sdaw'));
        const root = load<Record<string, unknown>>(payloadOf(decoded, 'root'));
        expect(readString(root, 'name')).toBe('conformance');
        expect(readString(root, 'kind')).toBe('root');
        const track = load<Record<string, unknown>>(payloadOf(decoded, 'track_a'));
        expect(readString(track, 'label')).toBe('alpha');
    });

    it('reads a Rust-authored string back as an ImmutableString, not a primitive', () => {
        // Pins the divergence `readString` normalises, so it cannot be silently
        // "fixed" by a coercion. A Rust `Str` scalar is not `===` its own text on this
        // side; see the commit body for where this reaches production.
        const decoded = decodeSdawFile(readFixture('rust-written-automerge.sdaw'));
        const track = load<Record<string, unknown>>(payloadOf(decoded, 'track_a'));

        expect(track.label).toBeInstanceOf(ImmutableString);
        expect(typeof track.label).toBe('object');
        expect(track.label === 'alpha').toBe(false);
    });

    it('refuses to read a field that is not a string rather than coercing it', () => {
        // Guards `readString` itself. A `String(...)` coercion would silently turn a
        // missing key into `'undefined'` and a number into its digits, which would
        // make every assertion above weaker than it looks.
        const decoded = decodeSdawFile(readFixture('rust-written-automerge.sdaw'));
        const track = load<Record<string, unknown>>(payloadOf(decoded, 'track_a'));

        expect(() => readString(track, 'nope')).toThrow('expected "nope" to be a string or ImmutableString');
    });

    it('rejects a DocId that is not valid UTF-8, as the Rust decoder does', () => {
        expect(() => decodeSdawFile(readFixture('corrupt-invalid-utf8-docid.sdaw'))).toThrow(
            'Invalid UTF-8 in document 0 DocId'
        );
    });
});

/**
 * Regenerates the TypeScript-authored half of the fixture set. Skipped by default;
 * run it after deliberately changing this encoder, then re-run the Rust conformance
 * tests — they are what proves the change is still readable from the other side:
 *
 *   SDAW_WRITE_FIXTURES=1 pnpm test:run src/modules/CrdtDocument/useCases/sdawFileFormat
 */
describe('.sdaw conformance: TypeScript-authored fixture generation', () => {
    it.runIf(process.env.SDAW_WRITE_FIXTURES === '1')('writes the TypeScript-authored fixtures', () => {
        writeFileSync(fixturePath('ts-written-empty.sdaw'), encodeSdawFile(canonicalEmpty()));
        writeFileSync(fixturePath('ts-written-single.sdaw'), encodeSdawFile(canonicalSingle()));
        writeFileSync(fixturePath('ts-written-multi.sdaw'), encodeSdawFile(canonicalMulti()));
        writeFileSync(fixturePath('ts-written-automerge.sdaw'), encodeSdawFile(canonicalAutomerge()));

        expect(decodeSdawFile(readFixture('ts-written-multi.sdaw')).size).toBe(4);
    });
});
