import { change, clone, from, getActorId, getObjectId, type Doc } from '@automerge/automerge';
import { afterEach, describe, expect, it } from 'vitest';

import { applyCanonicalStorageSlotMutation } from '../applyCanonicalStorageSlotMutation';
import {
    configureAutomergeStoragePort,
    createAutomergeStorage,
    flushAutomergeStorageWrites,
} from '../createAutomergeStorage';

type State = { rows: { id: string; beat: number }[] };
type Document = { slot: State; _storagePublicationEvidence?: unknown[] };

afterEach(() => {
    flushAutomergeStorageWrites();
    configureAutomergeStoragePort(null);
});

describe('canonical default storage-slot callback', () => {
    it.each([false, true])('matches the actual ordinary callback including inherited evidence: %s', (unchanged) => {
        const base: State = {
            rows: [
                { id: 'kept', beat: 0.9 },
                { id: 'old', beat: 1.25 },
            ],
        };
        const desired: State = unchanged ? base : { rows: [base.rows[0]!, { id: 'new', beat: 2.25 }] };
        const seed = from<Document>({ slot: base, _storagePublicationEvidence: [{ old: true }] });
        let ordinary: Doc<Document> = clone(seed, { actor: getActorId(seed) });
        configureAutomergeStoragePort({
            getDoc: () => ordinary,
            hasDoc: () => true,
            getSemanticMessage: () => undefined,
            mutateDoc: ({ changeFn }) => {
                ordinary = change(ordinary, changeFn);
            },
        });
        const storage = createAutomergeStorage<State>('root', 'slot');
        storage.hydrate?.();
        storage.set(desired);
        flushAutomergeStorageWrites();
        const actual = change(clone(seed, { actor: getActorId(seed) }), (doc) =>
            applyCanonicalStorageSlotMutation(doc, {
                kind: 'canonical-json-slot-v1',
                key: 'slot',
                baseValue: base,
                value: desired,
                documentPresence: { slot: base },
            })
        );
        expect(actual).toEqual(ordinary);
        expect(getObjectId(actual.slot.rows)).toBe(getObjectId(seed.slot.rows));
        expect(getObjectId(actual.slot.rows[0])).toBe(getObjectId(seed.slot.rows[0]));
        expect(Object.hasOwn(actual, '_storagePublicationEvidence')).toBe(unchanged);
    });

    it.each([undefined, { slot: { rows: [] } }])(
        'keeps omitted and captured-absent presence distinct: %j',
        (documentPresence) => {
            const row = { id: 'seed', beat: 1.25 };
            const base = { rows: [row] };
            const initial = from<Document>({ slot: { rows: [] } });
            const result = change(initial, (doc) =>
                applyCanonicalStorageSlotMutation(doc, {
                    kind: 'canonical-json-slot-v1',
                    key: 'slot',
                    baseValue: base,
                    value: base,
                    documentPresence,
                })
            );
            expect(result.slot.rows).toEqual(documentPresence ? [row] : []);
        }
    );
});
