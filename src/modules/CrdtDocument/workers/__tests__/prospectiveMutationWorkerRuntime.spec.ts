import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

import {
    applyChanges,
    change,
    clone,
    decodeChange,
    from,
    getActorId,
    getChanges,
    getHeads,
    getObjectId,
    merge,
    save,
} from '@automerge/automerge';
import * as native from '@automerge/automerge/slim';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { applyCanonicalStorageSlotMutation } from '#/infra/store/storage/applyCanonicalStorageSlotMutation';

import { parseProspectiveMutationWorkerRequest } from '../../models/ProspectiveMutationWorkerProtocol';
import { encodeBoundedMutationSequence } from '../encodeBoundedMutationSequence';
import { materializeProspectiveMutation } from '../prospectiveMutationWorkerRuntime';

vi.mock('@automerge/automerge/slim', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@automerge/automerge/slim')>();
    return { ...actual, free: vi.fn(actual.free) };
});
beforeAll(async () => {
    const require = createRequire(import.meta.url);
    const binary = readFileSync(require.resolve('@automerge/automerge/automerge.wasm'));
    await native.initializeWasm(Uint8Array.from(binary));
});
beforeEach(() => {
    vi.mocked(native.free).mockClear();
});

type Row = { id: string; value: number };
type Document = { slot: { rows: Row[] }; _storagePublicationEvidence?: unknown[] };
const actor = 'aaaaaaaaaaaaaaaa';

function fixture() {
    const base = {
        rows: [
            { id: 'locked', value: 1.25 },
            { id: 'old', value: 2.25 },
            { id: 'user', value: 0.9 },
        ],
    };
    const desired = { rows: [base.rows[0]!, { id: 'new', value: 3.25 }, base.rows[2]!] };
    const initial = from<Document>({ slot: base, _storagePublicationEvidence: [{ old: true }] }, { actor });
    const mutation = {
        kind: 'canonical-json-slot-v1' as const,
        key: 'slot',
        baseValue: base,
        value: desired,
        documentPresence: { slot: base },
    };
    return { initial, mutation };
}

describe('private canonical materialization Worker runtime', () => {
    it('keeps a bounded no-op on the original native heads with no changes', () => {
        const { initial, mutation } = fixture();
        const encoding = clone(initial, { actor });
        try {
            const heads = getHeads(initial);
            expect(
                materializeProspectiveMutation({
                    seed: save(encoding),
                    actor,
                    heads,
                    preparationPolicy: 'bounded-native-sequence-v1',
                    mutation: { ...mutation, value: mutation.baseValue },
                })
            ).toEqual({ changes: [], heads, sequence: { changeCount: 0, operationCount: 0 } });
        } finally {
            native.free(encoding);
            native.free(initial);
        }
    });

    it('refuses to split a native history with two edits since capture', () => {
        const initial = native.from({ markers: 0 }, { actor });
        const heads = native.getHeads(initial);
        const first = native.change(native.clone(initial, { actor }), (draft) => {
            draft.markers = 1;
        });
        const second = native.change(first, (draft) => {
            draft.markers = 2;
        });
        try {
            expect(native.getChangesSince(second, heads)).toHaveLength(2);
            expect(() => encodeBoundedMutationSequence(second, heads)).toThrow(
                'Bounded native preparation requires one canonical no-author change'
            );
        } finally {
            native.free(second);
            native.free(initial);
        }
    });

    it('refuses an indivisible native string operation above the uncompressed bound', () => {
        const initial = native.from({ text: new native.ImmutableString('') }, { actor });
        const heads = native.getHeads(initial);
        const changed = native.change(native.clone(initial, { actor }), (draft) => {
            draft.text = new native.ImmutableString('x'.repeat(65_536));
        });
        try {
            const [bytes] = native.getChangesSince(changed, heads);
            if (!bytes) {
                throw new Error('Expected one actual native string change');
            }
            expect(native.decodeChange(bytes).ops).toHaveLength(1);
            expect(() => encodeBoundedMutationSequence(changed, heads)).toThrow(
                'Native sequence change exceeds its uncompressed bound'
            );
        } finally {
            native.free(changed);
            native.free(initial);
        }
    });

    it('bounds an explicitly requested native sequence while retaining the actual canonical target', () => {
        const initial = from({ slot: { text: '' } }, { actor });
        const result = materializeProspectiveMutation({
            seed: save(clone(initial)),
            actor,
            heads: getHeads(initial),
            preparationPolicy: 'bounded-native-sequence-v1',
            message: 'Capture arrangement',
            mutation: {
                kind: 'canonical-json-slot-v1',
                key: 'slot',
                baseValue: { text: '' },
                value: { text: 'native sequence '.repeat(300) },
                documentPresence: { slot: { text: '' } },
            },
        });
        expect(result.changes.length).toBeGreaterThan(1);
        let replay = clone(initial, { actor });
        for (const bytes of result.changes) {
            expect(bytes.byteLength).toBeLessThanOrEqual(65_536);
            expect(decodeChange(bytes).ops.length).toBeLessThanOrEqual(384);
            [replay] = applyChanges(replay, [bytes]);
        }
        expect(replay).toEqual({ slot: { text: 'native sequence '.repeat(300) } });
        expect(getHeads(replay)).toEqual(result.heads);
    });

    it('preserves Detect confidence exactly across bounded changes with mixed scalars and peer edits', () => {
        const base = { markers: [] };
        const initial = from({ slot: base, collaborative: { title: 'Original', revision: 7 } }, { actor });
        const peer = change(clone(initial, { actor: 'bbbbbbbbbbbbbbbb' }), (doc) => {
            doc.collaborative.title = 'Peer edit';
            doc.collaborative.revision = 340;
        });
        const source = merge(clone(initial, { actor }), peer);
        const confidence = 0.9517297589061063;
        const target = {
            markers: [
                { id: 'warp-auto', confidence, originalBeat: 2.453333333333333, locked: false, rank: 300 },
                { id: 'warp-later', confidence, originalBeat: 4.125, locked: true, rank: -17 },
            ],
            description: 'native sequence '.repeat(300),
        };
        const request = {
            seed: save(clone(source)),
            actor,
            heads: getHeads(source),
            message: 'Detect transients',
            time: 7,
            mutation: {
                kind: 'canonical-json-slot-v1' as const,
                key: 'slot',
                baseValue: base,
                value: target,
                documentPresence: { slot: base },
            },
        };
        const single = materializeProspectiveMutation(request);
        const [ordinary] = applyChanges(clone(source, { actor }), single.changes);
        const bounded = materializeProspectiveMutation({ ...request, preparationPolicy: 'bounded-native-sequence-v1' });
        expect(bounded.changes.length).toBeGreaterThan(1);
        const [replayed] = applyChanges(clone(source, { actor }), bounded.changes);

        expect(ordinary.slot).toEqual(target);
        expect(replayed.slot).toEqual(ordinary.slot);
        expect(replayed.collaborative).toEqual({ title: 'Peer edit', revision: 340 });
        expect(getHeads(replayed)).toEqual(bounded.heads);
    });

    it.each([
        {},
        { message: undefined, time: undefined },
        { message: '', time: 0 },
        { message: 'Detect', time: -1 },
        { message: 'Detect', time: 0.5 },
    ])('retains optional envelope metadata acceptance for %j', (metadata) => {
        const { initial, mutation } = fixture();
        const request = { seed: save(clone(initial)), actor, heads: getHeads(initial), mutation, ...metadata };
        const parsed = parseProspectiveMutationWorkerRequest(request);
        expect(parsed.message).toBe(metadata.message);
        expect(parsed.time).toBe(metadata.time);
        expect(parsed.seed.buffer).toBe(request.seed.buffer);
    });

    it('accepts inherited envelope fields without inventing an own-property requirement', () => {
        const { initial, mutation } = fixture();
        const request = {
            seed: save(clone(initial)),
            actor,
            heads: getHeads(initial),
            mutation,
            message: '',
            time: -0.5,
        };
        const parsed = parseProspectiveMutationWorkerRequest(Object.create(request));
        expect(parsed).toEqual(request);
    });

    it.each([
        { message: null },
        { message: 1 },
        { time: null },
        { time: '1' },
        { time: Number.NaN },
        { time: Number.POSITIVE_INFINITY },
        { time: Number.NEGATIVE_INFINITY },
    ])('retains optional envelope metadata refusal for %j', (metadata) => {
        const { initial, mutation } = fixture();
        const request = { seed: save(clone(initial)), actor, heads: getHeads(initial), mutation, ...metadata };
        expect(() => parseProspectiveMutationWorkerRequest(request)).toThrowError(TypeError);
        expect(() => parseProspectiveMutationWorkerRequest(request)).toThrowError(
            /^Invalid prospective mutation Worker envelope$/
        );
    });

    it('refuses envelope metadata before an independently invalid canonical mutation', () => {
        const { initial, mutation } = fixture();
        const request = {
            seed: save(clone(initial)),
            actor,
            heads: getHeads(initial),
            message: null,
            mutation: { ...mutation, value: { callback: () => undefined } },
        };
        expect(() => parseProspectiveMutationWorkerRequest(request)).toThrowError(TypeError);
        expect(() => parseProspectiveMutationWorkerRequest(request)).toThrowError(
            /^Invalid prospective mutation Worker envelope$/
        );
    });

    it.each([undefined, '', 'Detect transients'])(
        'matches actual public canonical bytes and metadata for message %s',
        (message) => {
            const { initial, mutation } = fixture();
            const request = {
                seed: Uint8Array.from(save(clone(initial))),
                actor,
                heads: getHeads(initial),
                message,
                time: 7,
                mutation,
            };
            const response = materializeProspectiveMutation(request);
            const [result] = applyChanges(clone(initial, { actor }), response.changes);
            expect(getHeads(result)).toEqual(response.heads);
            const baseline = change(clone(initial, { actor }), { message: message || undefined, time: 7 }, (doc) =>
                applyCanonicalStorageSlotMutation(doc, mutation)
            );
            expect(getChanges(initial, result)).toEqual(getChanges(initial, baseline));
            const changes = getChanges(initial, result);
            expect(changes).toHaveLength(1);
            expect(decodeChange(changes[0]!)).toMatchObject({ actor, seq: 2, deps: getHeads(initial), time: 7 });
            expect(getActorId(result)).toBe(actor);
            expect(getObjectId(result.slot.rows)).toBe(getObjectId(initial.slot.rows));
            expect(getObjectId(result.slot.rows[0])).toBe(getObjectId(initial.slot.rows[0]));
            expect(result).toEqual(baseline);
            const peer = change(clone(initial, { actor: 'bbbbbbbbbbbbbbbb' }), (doc) => {
                doc.slot.rows[0]!.value = 9.5;
                doc.slot.rows.splice(1, 1, { id: 'peer', value: 4.75 });
            });
            const [merged] = applyChanges(peer, changes);
            const [expected] = applyChanges(clone(peer), getChanges(initial, baseline));
            expect(merged).toEqual(expected);
            expect(merge(clone(result), clone(peer))).toEqual(merge(clone(peer), clone(baseline)));
            expect(merged.slot.rows.find((row) => row.id === 'locked')?.value).toBe(9.5);
            expect(merged.slot.rows.some((row) => row.id === 'peer')).toBe(true);
            expect(native.free).toHaveBeenCalledTimes(1);
        }
    );

    it('preserves a genuine canonical zero-change no-op', () => {
        const { initial, mutation } = fixture();
        const response = materializeProspectiveMutation({
            seed: save(clone(initial)),
            actor,
            heads: getHeads(initial),
            mutation: { ...mutation, value: mutation.baseValue },
        });
        expect(response.changes).toEqual([]);
        const [result] = applyChanges(clone(initial, { actor }), response.changes);
        expect(getHeads(result)).toEqual(response.heads);
        expect(getChanges(initial, result)).toEqual([]);
        expect(result).toEqual(initial);
        expect(native.free).toHaveBeenCalledTimes(1);
    });

    it.each(['heads', 'actor', 'kind', 'callback'] as const)(
        'rejects invalid %s before producing a candidate',
        (kind) => {
            const { initial, mutation } = fixture();
            const request = { seed: save(clone(initial)), actor, heads: getHeads(initial), mutation };
            let invalid: unknown;
            if (kind === 'heads') {
                invalid = { ...request, heads: ['0'.repeat(64)] };
            } else if (kind === 'actor') {
                invalid = { ...request, actor: 'invalid' };
            } else if (kind === 'kind') {
                invalid = { ...request, mutation: { ...mutation, kind: 'custom' } };
            } else {
                invalid = { ...request, mutation: { ...mutation, value: { callback: () => undefined } } };
            }
            expect(() => materializeProspectiveMutation(invalid)).toThrow();
            expect(initial.slot.rows.map((row) => row.id)).toEqual(['locked', 'old', 'user']);
            expect(native.free).toHaveBeenCalledTimes(kind === 'heads' ? 1 : 0);
        }
    );
});
