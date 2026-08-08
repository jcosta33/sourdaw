import { describe, it, expect, vi, beforeEach } from 'vitest';

import { type AppAction } from '#/utils/handlerContract';

import { handleSplitClip } from '../handleSplitClip';

const mocks = vi.hoisted(() => ({
    getNextAppActionClipId: vi.fn(),
    prepareClipSplit: vi.fn(),
    splitClip: vi.fn(),
}));

vi.mock('../../../useCases/clip/getNextAppActionClipId', () => ({
    getNextAppActionClipId: mocks.getNextAppActionClipId,
}));

vi.mock('../../../useCases/clipEditing/prepareClipSplit', () => ({
    prepareClipSplit: mocks.prepareClipSplit,
}));

vi.mock('../../../useCases/clipEditing/splitClip', () => ({
    splitClip: mocks.splitClip,
}));

describe('handleSplitClip', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getNextAppActionClipId.mockReturnValue('right-clip');
        mocks.prepareClipSplit.mockReturnValue(null);
        mocks.splitClip.mockReturnValue('right-clip');
    });

    it('executes splitClip with the provided payload', () => {
        const result = handleSplitClip.execute({
            type: 'splitClip',
            payload: { clipId: 'c1', beat: 2.5 },
        });

        expect(mocks.splitClip).toHaveBeenCalledWith('c1', 2.5, undefined, undefined, undefined);
        expect(result).toEqual({ status: 'written' });
    });

    it('returns no-write when the split is rejected', () => {
        mocks.splitClip.mockReturnValue(null);

        const result = handleSplitClip.execute({
            type: 'splitClip',
            payload: { clipId: 'c1', beat: 2.5 },
        });

        expect(result).toEqual({ status: 'no-write' });
    });

    it('prepares deterministic replay metadata and guarded inverse/redo actions', () => {
        const emptyMidi = {
            notes: { present: false, value: [] },
            controlChanges: { present: false, value: [] },
            pitchBends: { present: false, value: [] },
        };
        const leftClip = {
            id: 'c1',
            trackId: 't1',
            name: 'Intro',
            startBeat: 0,
            endBeat: 5,
            type: 'audio',
            fadeInBeats: 0,
            fadeOutBeats: 0,
            gain: 1,
            color: '#000000',
            locked: false,
            muted: false,
        };
        const rightClip = { ...leftClip, id: 'right-clip', name: 'Intro (R)', startBeat: 2.5 };
        const previous = {
            trackId: 't1',
            leftClip,
            rightClip: null,
            rightClipIndex: 1,
            sourceMidi: emptyMidi,
            rightMidi: emptyMidi,
        };
        const next = {
            ...previous,
            leftClip: { ...leftClip, name: 'Intro (L)', endBeat: 2.5 },
            rightClip,
        };
        mocks.prepareClipSplit.mockReturnValue({
            adjustedMediaSplit: 2.5,
            previous,
            next,
            rightClipId: 'right-clip',
            targetNoteIds: ['note-right'],
        });
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
    });

    it('describes the actual zero-crossing-adjusted split beat', async () => {
        const emptyMidi = {
            notes: { present: false, value: [] },
            controlChanges: { present: false, value: [] },
            pitchBends: { present: false, value: [] },
        };
        const sourceClip = {
            id: 'c1',
            trackId: 't1',
            name: 'Intro',
            startBeat: 0,
            endBeat: 8,
            type: 'audio',
            fadeInBeats: 0,
            fadeOutBeats: 0,
            gain: 1,
            color: '#000000',
            locked: false,
            muted: false,
        };
        mocks.prepareClipSplit.mockReturnValue({
            adjustedMediaSplit: 4.125,
            previous: {
                trackId: 't1',
                leftClip: sourceClip,
                rightClip: null,
                rightClipIndex: 1,
                sourceMidi: emptyMidi,
                rightMidi: emptyMidi,
            },
            next: {
                trackId: 't1',
                leftClip: { ...sourceClip, name: 'Intro (L)', endBeat: 4.125 },
                rightClip: { ...sourceClip, id: 'right-clip', name: 'Intro (R)', startBeat: 4.125 },
                rightClipIndex: 1,
                sourceMidi: emptyMidi,
                rightMidi: emptyMidi,
            },
            rightClipId: 'right-clip',
            targetNoteIds: [],
        });

        const action: Extract<AppAction, { type: 'splitClip' }> = {
            type: 'splitClip',
            payload: { clipId: 'c1', beat: 4 },
        };
        const description = handleSplitClip.describe(action);

        expect(description.label).toBe('Split clip "Intro" (c1) near requested beat 4 at beat 4.125');
        expect(action.payload.resolvedBeat).toBe(4.125);

        await handleSplitClip.execute(action);
        expect(mocks.splitClip).toHaveBeenCalledWith('c1', 4, 'right-clip', [], 4.125);
    });

    it('is undoable', () => {
        expect(handleSplitClip.undoable).toBe(true);
        expect(handleSplitClip.requiresAbortCompensation).toBe(false);
    });
});
