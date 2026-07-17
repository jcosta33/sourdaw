import { describe, it, expect, beforeEach } from 'vitest';

import { midiStore } from '../../../stores/midiStore';
import { handleHumanizeNotes } from '../handleHumanizeNotes';

type HumanizeNotesAction = Parameters<typeof handleHumanizeNotes.execute>[0];

function note(id: string) {
    return {
        id,
        pitch: 60,
        startBeat: 1,
        duration: 0.25,
        velocity: 100,
    };
}

function seedStore() {
    midiStore.set({
        notesByClipId: { clip1: [note('a'), note('b'), note('c')] },
        ccByClipId: {},
        pitchBendByClipId: {},
    });
}

function snapshot() {
    return (midiStore.value?.notesByClipId.clip1 ?? []).map((node) => ({
        startBeat: node.startBeat,
        velocity: node.velocity,
    }));
}

describe('handleHumanizeNotes — deterministic undo/redo (item #2)', () => {
    beforeEach(seedStore);

    it('captures the RNG seed into the action payload on first execute', () => {
        const action: HumanizeNotesAction = {
            type: 'humanizeNotes',
            payload: { clipId: 'clip1', amount: 0.5 },
        };

        void handleHumanizeNotes.execute(action);

        // The handler writes back the seed it used so the stored undo entry —
        // which executeAppAction replays verbatim on redo — can reproduce it.
        expect(Number.isFinite(action.payload.seed)).toBe(true);
    });

    it('reproduces identical offsets when the same action object is replayed (redo)', () => {
        const action: HumanizeNotesAction = {
            type: 'humanizeNotes',
            payload: { clipId: 'clip1', amount: 0.5 },
        };

        // First execute — random seed generated and captured.
        void handleHumanizeNotes.execute(action);
        const firstResult = snapshot();

        // The humanized offsets must actually move the notes, otherwise the
        // determinism claim would be vacuously true.
        expect(firstResult).not.toEqual([
            { startBeat: 1, velocity: 100 },
            { startBeat: 1, velocity: 100 },
            { startBeat: 1, velocity: 100 },
        ]);

        // Simulate undo→redo: reset the doc to its pre-humanize state and replay
        // the SAME action object (now carrying the captured seed), exactly as
        // executeAppAction does on redo.
        seedStore();
        expect(action.payload.seed).toBeDefined();
        void handleHumanizeNotes.execute(action);
        const replayResult = snapshot();

        expect(replayResult).toEqual(firstResult);
    });

    it('is non-deterministic across separate executes without a captured seed', () => {
        // Two independent first-executes (no captured seed) should almost always
        // diverge — this guards against the regression where the handler pinned
        // a constant seed and made every humanize identical.
        const actionA: HumanizeNotesAction = { type: 'humanizeNotes', payload: { clipId: 'clip1', amount: 0.5 } };
        void handleHumanizeNotes.execute(actionA);
        const resultA = snapshot();

        seedStore();
        const actionB: HumanizeNotesAction = { type: 'humanizeNotes', payload: { clipId: 'clip1', amount: 0.5 } };
        void handleHumanizeNotes.execute(actionB);
        const resultB = snapshot();

        expect(actionA.payload.seed).not.toBe(actionB.payload.seed);
        expect(resultB).not.toEqual(resultA);
    });
});
