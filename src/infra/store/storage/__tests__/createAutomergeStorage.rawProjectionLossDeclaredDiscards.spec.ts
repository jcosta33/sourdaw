import { describe, expect, it } from 'vitest';

import { createAutomergeStorage, findAutomergeStorageRawProjectionLosses } from '../createAutomergeStorage';

/**
 * A store may drop a key on purpose: transient view state an older build
 * persisted, a field retired from the model. The raw projection-loss detector
 * cannot tell such a key from a projection defect, and a document carrying one
 * is held in repair-required forever — which refuses the very save that would
 * rewrite the document without it.
 *
 * `discardsRaw` is the store's declaration of what it discards. It removes that
 * content from the raw side before containment is checked, and nothing else:
 * every other dropped key still reports.
 */

function registerSlot(input: {
    slot: string;
    sanitize: (value: unknown) => unknown;
    discardsRaw?: (raw: unknown) => unknown;
}): void {
    createAutomergeStorage<unknown>('root', input.slot, {
        discardsRaw: input.discardsRaw,
    }).registerInboundSanitizer?.(input.sanitize);
}

function findSlotLosses(slot: string, rawValue: unknown): string[] {
    return findAutomergeStorageRawProjectionLosses({ docId: 'root', document: { [slot]: rawValue } });
}

function withoutKey(key: string): (value: unknown) => unknown {
    return (value) => {
        const record = { ...(value as Record<string, unknown>) };
        Reflect.deleteProperty(record, key);
        return record;
    };
}

describe('createAutomergeStorage declared raw discards', () => {
    it('reports a loss for a dropped key the store never declared', () => {
        registerSlot({ slot: 'undeclared', sanitize: withoutKey('ghostClips') });

        expect(findSlotLosses('undeclared', { tracks: [], ghostClips: [] })).toEqual(['undeclared']);
    });

    it('reports no loss once the store declares that key as discarded', () => {
        registerSlot({
            slot: 'declared',
            sanitize: withoutKey('ghostClips'),
            discardsRaw: withoutKey('ghostClips'),
        });

        expect(findSlotLosses('declared', { tracks: [], ghostClips: [] })).toEqual([]);
    });

    it('still reports the loss when the declaration names a different key', () => {
        registerSlot({
            slot: 'mismatched',
            sanitize: withoutKey('ghostClips'),
            discardsRaw: withoutKey('virginTerritory'),
        });

        expect(findSlotLosses('mismatched', { tracks: [], ghostClips: [] })).toEqual(['mismatched']);
    });

    it('still reports a key the projection drops beside the declared one', () => {
        registerSlot({
            slot: 'partial',
            sanitize: (value) => withoutKey('unreadable')(withoutKey('ghostClips')(value)),
            discardsRaw: withoutKey('ghostClips'),
        });

        expect(findSlotLosses('partial', { tracks: [], ghostClips: [], unreadable: 1 })).toEqual(['partial']);
    });
});
