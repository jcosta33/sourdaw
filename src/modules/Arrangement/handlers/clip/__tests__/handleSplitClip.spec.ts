import { describe, it, expect, vi, beforeEach } from 'vitest';

import { type AppAction, type ClipSplitActionSnapshot, type ClipStateSnapshot } from '#/utils/handlerContract';

import { type prepareClipSplit } from '../../../useCases/clipEditing/prepareClipSplit';
import { handleSplitClip } from '../handleSplitClip';

const mocks = vi.hoisted(() => ({
    getNextAppActionClipId: vi.fn(),
    prepareClipSplit: vi.fn(),
    applyPreparedClipSplit: vi.fn(),
}));

vi.mock('../../../useCases/clip/getNextAppActionClipId', () => ({
    getNextAppActionClipId: mocks.getNextAppActionClipId,
}));

vi.mock('../../../useCases/clipEditing/prepareClipSplit', () => ({
    prepareClipSplit: mocks.prepareClipSplit,
}));

vi.mock('../../../useCases/clipEditing/applyPreparedClipSplit', () => ({
    applyPreparedClipSplit: mocks.applyPreparedClipSplit,
}));

type PreparedClipSplit = NonNullable<ReturnType<typeof prepareClipSplit>>;

function preparedAudioSplit(actualBeat: number, sourceEndBeat: number): PreparedClipSplit {
    const emptyMidi = {
        notes: { present: false, value: [] },
        controlChanges: { present: false, value: [] },
        pitchBends: { present: false, value: [] },
    };
    const sourceClip: ClipStateSnapshot = {
        id: 'c1',
        trackId: 't1',
        name: 'Intro',
        startBeat: 0,
        endBeat: sourceEndBeat,
        type: 'audio',
        fadeInBeats: 0,
        fadeOutBeats: 0,
        gain: 1,
        color: '#000000',
        locked: false,
        muted: false,
    };
    const previous: ClipSplitActionSnapshot = {
        trackId: 't1',
        leftClip: sourceClip,
        rightClip: null,
        rightClipIndex: 1,
        sourceMidi: emptyMidi,
        rightMidi: emptyMidi,
    };
    const next: ClipSplitActionSnapshot = {
        ...previous,
        leftClip: { ...sourceClip, name: 'Intro (L)', endBeat: actualBeat },
        rightClip: { ...sourceClip, id: 'right-clip', name: 'Intro (R)', startBeat: actualBeat },
    };
    return {
        adjustedMediaSplit: actualBeat,
        previous,
        next,
        rightClipId: 'right-clip',
        targetNoteIds: [],
    } satisfies PreparedClipSplit;
}

function preparedMidiSplit(): PreparedClipSplit {
    const audioPlan = preparedAudioSplit(2.5, 5);
    const rightClip = audioPlan.next.rightClip;
    if (!rightClip) {
        throw new Error('expected prepared audio split to include a right clip');
    }
    const crossingNote = { id: 'note-crossing', pitch: 60, startBeat: 2, duration: 1, velocity: 100 };
    const previous: ClipSplitActionSnapshot = {
        ...audioPlan.previous,
        leftClip: { ...audioPlan.previous.leftClip, type: 'midi' },
        sourceMidi: {
            ...audioPlan.previous.sourceMidi,
            notes: { present: true, value: [crossingNote] },
        },
    };
    const next: ClipSplitActionSnapshot = {
        ...audioPlan.next,
        leftClip: { ...audioPlan.next.leftClip, type: 'midi' },
        rightClip: { ...rightClip, type: 'midi' },
        sourceMidi: {
            ...audioPlan.next.sourceMidi,
            notes: { present: true, value: [{ ...crossingNote, duration: 0.5 }] },
        },
        rightMidi: {
            ...audioPlan.next.rightMidi,
            notes: { present: true, value: [{ ...crossingNote, id: 'note-right', startBeat: 2.5, duration: 0.5 }] },
        },
    };
    return { ...audioPlan, previous, next, targetNoteIds: ['note-right'] } satisfies PreparedClipSplit;
}

describe('handleSplitClip', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getNextAppActionClipId.mockReturnValue('right-clip');
        mocks.prepareClipSplit.mockReturnValue(preparedAudioSplit(2.5, 5));
        mocks.applyPreparedClipSplit.mockReturnValue(true);
    });

    it('prepares the provided payload and applies the same plan', () => {
        const plan = preparedAudioSplit(2.5, 5);
        mocks.prepareClipSplit.mockReturnValue(plan);
        const action: Extract<AppAction, { type: 'splitClip' }> = {
            type: 'splitClip',
            payload: { clipId: 'c1', beat: 2.5 },
        };
        const result = handleSplitClip.execute(action);

        expect(mocks.prepareClipSplit).toHaveBeenCalledWith({
            clipId: 'c1',
            splitBeat: 2.5,
            rightClipId: 'right-clip',
            resolvedSplitBeat: undefined,
            targetNoteIds: undefined,
        });
        expect(mocks.applyPreparedClipSplit).toHaveBeenCalledTimes(1);
        expect(mocks.applyPreparedClipSplit.mock.calls[0]?.[0]).toBe(plan);
        expect(action.payload).toEqual({
            clipId: 'c1',
            beat: 2.5,
            rightClipId: 'right-clip',
            targetNoteIds: [],
            resolvedBeat: 2.5,
        });
        expect(result).toEqual({ status: 'written' });
    });

    it('returns no-write when the split is rejected', () => {
        mocks.prepareClipSplit.mockReturnValue(null);

        const result = handleSplitClip.execute({
            type: 'splitClip',
            payload: { clipId: 'c1', beat: 2.5 },
        });

        expect(result).toEqual({ status: 'no-write' });
        expect(mocks.applyPreparedClipSplit).not.toHaveBeenCalled();
    });

    it('returns no-write when the prepared split is refused by the applicator', () => {
        const plan = preparedAudioSplit(2.5, 5);
        mocks.prepareClipSplit.mockReturnValue(plan);
        mocks.applyPreparedClipSplit.mockReturnValue(false);
        const action: Extract<AppAction, { type: 'splitClip' }> = {
            type: 'splitClip',
            payload: { clipId: 'c1', beat: 2.5 },
        };
        const description = handleSplitClip.describe(action);
        expect(description.inverseAction).not.toBeNull();

        const result = handleSplitClip.execute(action);

        expect(mocks.applyPreparedClipSplit.mock.calls[0]?.[0]).toBe(plan);
        expect(result).toEqual({ status: 'no-write' });
        expect(description.inverseAction).toBeNull();
        expect(description.redoAction).toBeUndefined();
    });

    it('prepares deterministic replay metadata and guarded inverse/redo actions', () => {
        const plan = preparedMidiSplit();
        const { previous, next } = plan;
        mocks.prepareClipSplit.mockReturnValue(plan);
        const action: Extract<AppAction, { type: 'splitClip' }> = {
            type: 'splitClip',
            payload: { clipId: 'c1', beat: 2.5 },
        };

        const desc = handleSplitClip.describe(action);

        expect(action.payload).toEqual({
            clipId: 'c1',
            beat: 2.5,
            rightClipId: 'right-clip',
            targetNoteIds: ['note-right'],
            resolvedBeat: 2.5,
        });
        expect(desc).toMatchObject({
            label: 'Split clip "Intro" (c1) at beat 2.5',
            inverseAction: {
                type: 'restoreClipSplitState',
                payload: { clipId: 'c1', rightClipId: 'right-clip', expected: next, replacement: previous },
            },
            redoAction: {
                type: 'restoreClipSplitState',
                payload: { clipId: 'c1', rightClipId: 'right-clip', expected: previous, replacement: next },
            },
        });
        // The undo leg fills this array in place and the redo reads it, so both
        // payloads must carry the SAME instance or the legs disagree (#4521).
        const inverse = desc.inverseAction as Extract<AppAction, { type: 'restoreClipSplitState' }>;
        const redo = desc.redoAction as Extract<AppAction, { type: 'restoreClipSplitState' }>;
        expect(inverse.payload.retiredTakeLanes).toEqual([]);
        expect(inverse.payload.retiredTakeLanes).toBe(redo.payload.retiredTakeLanes);
    });

    it('describes the actual zero-crossing-adjusted split beat', async () => {
        const plan = preparedAudioSplit(4.125, 8);
        mocks.prepareClipSplit.mockReturnValue(plan);

        const action: Extract<AppAction, { type: 'splitClip' }> = {
            type: 'splitClip',
            payload: { clipId: 'c1', beat: 4 },
        };
        const description = handleSplitClip.describe(action);

        expect(description.label).toBe('Split clip "Intro" (c1) near requested beat 4 at beat 4.125');
        expect(action.payload.resolvedBeat).toBe(4.125);

        expect(await handleSplitClip.execute(action)).toEqual({ status: 'written' });
        expect(mocks.prepareClipSplit).toHaveBeenLastCalledWith({
            clipId: 'c1',
            splitBeat: 4,
            rightClipId: 'right-clip',
            resolvedSplitBeat: 4.125,
            targetNoteIds: [],
        });
        expect(mocks.applyPreparedClipSplit.mock.calls[0]?.[0]).toBe(plan);
        expect(plan.next.leftClip.endBeat).toBe(4.125);
        expect(plan.next.rightClip?.startBeat).toBe(4.125);
    });

    it('is undoable', () => {
        expect(handleSplitClip.undoable).toBe(true);
        expect(handleSplitClip.requiresAbortCompensation).toBe(false);
    });
});
