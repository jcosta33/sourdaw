import { describe, it, expect, beforeEach } from 'vitest';

import { createUndoEntry } from '../../useCases/createUndoEntry';
import { undoStore as public_undo_store } from '../undo-store-facade';
import { undoStore as mutable_undo_store } from '../undoStore';

describe('undoStore facade', () => {
    beforeEach(() => {
        mutable_undo_store.set({ past: [], future: [] });
    });

    it('does not expose write methods', () => {
        expect(public_undo_store).not.toHaveProperty('set');
        expect(public_undo_store).not.toHaveProperty('update');
        expect(public_undo_store).not.toHaveProperty('clear');
        expect(public_undo_store).not.toHaveProperty('hydrate');
    });

    it('mirrors the mutable undo store snapshot and subscriptions', () => {
        const past_lengths: number[] = [];
        const unsubscribe = public_undo_store.subscribe((value) => {
            past_lengths.push(value?.past.length ?? 0);
        });
        const entry = createUndoEntry(
            'commit',
            { type: 'setTempo', payload: { bpm: 120 } },
            { type: 'setTempo', payload: { bpm: 100 } }
        );

        mutable_undo_store.set({ past: [entry], future: [] });

        expect(public_undo_store.value?.past).toEqual([{ label: 'commit' }]);
        expect(public_undo_store.getSnapshot()?.past).toEqual([{ label: 'commit' }]);
        expect(past_lengths).toEqual([1]);

        unsubscribe();
    });

    it('returns immutable snapshots that do not share mutable store references', () => {
        const entry = createUndoEntry(
            'commit',
            { type: 'setTempo', payload: { bpm: 120 } },
            { type: 'setTempo', payload: { bpm: 100 } }
        );
        const mutable_state = { past: [entry], future: [] };
        mutable_undo_store.set(mutable_state);

        const snapshot = public_undo_store.getSnapshot();

        expect(snapshot).not.toBeNull();
        if (!snapshot) {
            throw new Error('expected undo facade snapshot');
        }
        expect(snapshot).not.toBe(mutable_state);
        expect(snapshot.past).not.toBe(mutable_state.past);
        expect(snapshot.future).not.toBe(mutable_state.future);
        expect(snapshot.past[0]).not.toBe(entry);
        expect(snapshot.past[0]).toEqual({ label: 'commit' });
        expect(Object.isFrozen(snapshot)).toBe(true);
        expect(Object.isFrozen(snapshot.past)).toBe(true);
        expect(Object.isFrozen(snapshot.future)).toBe(true);
        expect(Object.isFrozen(snapshot.past[0])).toBe(true);
        expect(() => Reflect.apply(Array.prototype.push, snapshot.past, [entry])).toThrow(TypeError);
        expect(Reflect.set(snapshot.past[0]!, 'label', 'mutated')).toBe(false);
        expect(mutable_undo_store.value?.past).toEqual([entry]);
    });

    it('keeps snapshot identity stable until the mutable store changes', () => {
        const first_entry = createUndoEntry(
            'first',
            { type: 'setTempo', payload: { bpm: 120 } },
            { type: 'setTempo', payload: { bpm: 100 } }
        );
        const second_entry = createUndoEntry('second', { type: 'toggleMetronome' }, { type: 'toggleMetronome' });
        mutable_undo_store.set({ past: [first_entry], future: [] });

        const first_snapshot = public_undo_store.getSnapshot();
        const repeated_snapshot = public_undo_store.getSnapshot();
        mutable_undo_store.set({ past: [first_entry, second_entry], future: [] });
        const changed_snapshot = public_undo_store.getSnapshot();

        expect(repeated_snapshot).toBe(first_snapshot);
        expect(changed_snapshot).not.toBe(first_snapshot);
        expect(changed_snapshot?.past).toEqual([{ label: 'first' }, { label: 'second' }]);
    });
});
