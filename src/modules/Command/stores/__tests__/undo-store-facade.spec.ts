import { describe, it, expect, beforeEach } from 'vitest';

import { createUndoEntry } from '../../useCases/commandQueries';
import { undoStore as publicUndoStore } from '../undo-store-facade';
import { undoStore as mutableUndoStore } from '../undoStore';

describe('undoStore facade', () => {
    beforeEach(() => {
        mutableUndoStore.set({ past: [], future: [] });
    });

    it('does not expose write methods', () => {
        expect(publicUndoStore).not.toHaveProperty('set');
        expect(publicUndoStore).not.toHaveProperty('update');
        expect(publicUndoStore).not.toHaveProperty('clear');
        expect(publicUndoStore).not.toHaveProperty('hydrate');
    });

    it('mirrors the mutable undo store snapshot and subscriptions', () => {
        const past_lengths: number[] = [];
        const unsubscribe = publicUndoStore.subscribe((value) => {
            past_lengths.push(value?.past.length ?? 0);
        });
        const entry = createUndoEntry(
            'commit',
            { type: 'setTempo', payload: { bpm: 120 } },
            { type: 'setTempo', payload: { bpm: 100 } }
        );

        mutableUndoStore.set({ past: [entry], future: [] });

        expect(publicUndoStore.value?.past).toEqual([entry]);
        expect(publicUndoStore.getSnapshot()?.past).toEqual([entry]);
        expect(past_lengths).toEqual([1]);

        unsubscribe();
    });
});
