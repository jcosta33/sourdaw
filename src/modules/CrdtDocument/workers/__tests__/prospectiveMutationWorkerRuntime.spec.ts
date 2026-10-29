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
    load,
    save,
} from '@automerge/automerge';
import { describe, expect, it } from 'vitest';

import { applyCanonicalStorageSlotMutation } from '#/infra/store/storage/applyCanonicalStorageSlotMutation';

import { materializeProspectiveMutation } from '../prospectiveMutationWorkerRuntime';

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
            const bytes = materializeProspectiveMutation(request);
            const result = load<Document>(bytes, { actor });
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
            expect(merged.slot.rows.find((row) => row.id === 'locked')?.value).toBe(9.5);
            expect(merged.slot.rows.some((row) => row.id === 'peer')).toBe(true);
        }
    );

    it('preserves a genuine canonical zero-change no-op', () => {
        const { initial, mutation } = fixture();
        const bytes = materializeProspectiveMutation({
            seed: save(clone(initial)),
            actor,
            heads: getHeads(initial),
            mutation: { ...mutation, value: mutation.baseValue },
        });
        const result = load<Document>(bytes, { actor });
        expect(getChanges(initial, result)).toEqual([]);
        expect(result).toEqual(initial);
    });

    it.each(['heads', 'actor', 'kind', 'callback'] as const)(
        'rejects invalid %s before producing a candidate',
        (kind) => {
            const { initial, mutation } = fixture();
            const request = { seed: save(clone(initial)), actor, heads: getHeads(initial), mutation };
            const invalid =
                kind === 'heads'
                    ? { ...request, heads: ['0'.repeat(64)] }
                    : kind === 'actor'
                      ? { ...request, actor: 'invalid' }
                      : kind === 'kind'
                        ? { ...request, mutation: { ...mutation, kind: 'custom' } }
                        : { ...request, mutation: { ...mutation, value: { callback: () => undefined } } };
            expect(() => materializeProspectiveMutation(invalid)).toThrow();
            expect(initial.slot.rows.map((row) => row.id)).toEqual(['locked', 'old', 'user']);
        }
    );
});
