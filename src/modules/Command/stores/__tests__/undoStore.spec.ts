import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { createUndoEntry } from '../../useCases/commandQueries';
import { pushUndo, undoStore } from '../undoStore';

const UNDO_SESSION_KEY = 'sourdaw-undo-session';

describe('undoStore / pushUndo', () => {
    beforeEach(() => {
        sessionStorage.removeItem(UNDO_SESSION_KEY);
        undoStore.set({ past: [], future: [] });
    });

    afterEach(() => {
        sessionStorage.removeItem(UNDO_SESSION_KEY);
    });

    it('should append an entry to past and clear future', () => {
        const alpha = createUndoEntry(
            'one',
            { type: 'setTempo', payload: { bpm: 120 } },
            { type: 'setTempo', payload: { bpm: 100 } }
        );
        const b = createUndoEntry('two', { type: 'stopPlayback' }, { type: 'togglePlayback' });
        undoStore.set({ past: [alpha], future: [b] });

        const next = createUndoEntry('three', { type: 'toggleMetronome' }, { type: 'toggleMetronome' });
        pushUndo(next);

        expect(undoStore.value?.past).toEqual([alpha, next]);
        expect(undoStore.value?.future).toEqual([]);
    });

    it('should not mutate when store value is null', () => {
        undoStore.set(null);
        const entry = createUndoEntry('x', { type: 'setTempo', payload: { bpm: 1 } }, null);
        pushUndo(entry);
        expect(undoStore.value).toBeNull();
    });

    it('should persist action stacks to sessionStorage when state updates', async () => {
        const entry = createUndoEntry(
            'persist',
            { type: 'setMasterGain', payload: { gain: 0.5 } },
            {
                type: 'setMasterGain',
                payload: { gain: 1 },
            }
        );
        pushUndo(entry);

        // Persistence writes are coalesced onto a microtask flush.
        await new Promise<void>((resolve) => queueMicrotask(resolve));

        const raw = sessionStorage.getItem(UNDO_SESSION_KEY);
        expect(raw).not.toBeNull();
        const parsed = JSON.parse(raw!) as { past: unknown[]; future: unknown[] };
        expect(parsed.future).toEqual([]);
        expect(parsed.past).toHaveLength(1);
        expect(parsed.past[0]).toMatchObject({ id: entry.id, label: 'persist', kind: 'action' });
    });
});
