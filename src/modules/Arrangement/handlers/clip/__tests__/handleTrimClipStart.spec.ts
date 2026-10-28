import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleTrimClipStart } from '../handleTrimClipStart';

const mocks = vi.hoisted(() => ({
    trimClipStart: vi.fn<typeof import('../../../useCases/clipEditing/trimClipStart').trimClipStart>(),
    getTrackStoreState: vi.fn<
        () => {
            tracks: {
                id: string;
                clips: { id: string; startBeat: number; type?: 'audio' | 'midi'; midiOffsetBeats?: number }[];
            }[];
        } | null
    >(),
}));

vi.mock('../../../useCases/clipEditing/trimClipStart', () => ({
    trimClipStart: mocks.trimClipStart,
}));

vi.mock('../../../useCases/getTrackStoreState', () => ({
    getTrackStoreState: mocks.getTrackStoreState,
}));

describe('handleTrimClipStart', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.trimClipStart.mockReset();
        mocks.getTrackStoreState.mockReturnValue(null);
    });

    it('executes trimClipStart with the provided payload', () => {
        void handleTrimClipStart.execute({
            type: 'trimClipStart',
            payload: { clipId: 'c1', newStartBeat: 2 },
        });

        expect(mocks.trimClipStart).toHaveBeenCalledWith('c1', 2, undefined, undefined);
    });

    it('provides a description', () => {
        const desc = handleTrimClipStart.describe({
            type: 'trimClipStart',
            payload: { clipId: 'c1', newStartBeat: 2 },
        });
        expect(desc.label).toBe('Trim clip start');
        expect(desc.inverseAction).toBeNull();
    });

    it('describes an inverse back to the pre-trim start beat', () => {
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [{ id: 't1', clips: [{ id: 'c1', startBeat: 1 }] }],
        });

        const desc = handleTrimClipStart.describe({
            type: 'trimClipStart',
            payload: { clipId: 'c1', newStartBeat: 2 },
        });

        expect(desc.inverseAction).toEqual({
            type: 'trimClipStart',
            payload: { clipId: 'c1', newStartBeat: 1, loopOriginBeat: null },
        });
    });

    it('is undoable', () => {
        expect(handleTrimClipStart.undoable).toBe(true);
    });

    it('preserves a fresh refusal as no-write', () => {
        mocks.trimClipStart.mockReturnValue(false);
        expect(
            handleTrimClipStart.execute({ type: 'trimClipStart', payload: { clipId: 'c1', newStartBeat: 2 } })
        ).toEqual({ status: 'no-write' });
    });

    it('records the actual MIDI owner capture and forwards it through the real inverse', () => {
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [{ id: 't1', clips: [{ id: 'cm', startBeat: 0, type: 'midi', midiOffsetBeats: 7 }] }],
        });
        const action = { type: 'trimClipStart' as const, payload: { clipId: 'cm', newStartBeat: 2 } };
        const description = handleTrimClipStart.describe(action);
        expect(description.redoAction?.type).toBe('trimClipStart');
        expect(description.redoAction?.payload).not.toBe(action.payload);
        const capture = {
            beatDelta: -6,
            coordinates: [{ kind: 'note' as const, id: 'note', beforeBeat: 8.1, afterBeat: 2.0999999999999996 }],
        };
        mocks.trimClipStart.mockImplementationOnce((_id, _start, _anchor, _offset, coordinates) => {
            if (!coordinates) {
                throw new Error('Expected MIDI coordinate capture output');
            }
            coordinates.capture = capture;
            return true;
        });
        expect(handleTrimClipStart.execute(action)).toEqual({ status: 'written' });
        expect(Object.hasOwn(action.payload, 'midiRowCoordinates')).toBe(false);
        expect(mocks.trimClipStart).toHaveBeenCalledWith('cm', 2, undefined, undefined, {
            restore: undefined,
            capture,
        });
        expect(description.inverseAction).toMatchObject({
            payload: { newStartBeat: 0, midiOffsetBeats: 7, midiRowCoordinates: capture },
        });
        if (description.inverseAction?.type !== 'trimClipStart') {
            throw new Error('Expected a trim inverse');
        }
        mocks.trimClipStart.mockReturnValueOnce(true);
        expect(handleTrimClipStart.execute(description.inverseAction)).toEqual({ status: 'written' });
        expect(mocks.trimClipStart).toHaveBeenLastCalledWith('cm', 0, null, 7, { restore: capture });
    });

    it.each([false, true])('distinguishes a fresh MIDI no-write from unsafe coordinate refusal: %s', (refused) => {
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [{ id: 't1', clips: [{ id: 'cm', startBeat: 0, type: 'midi' }] }],
        });
        mocks.trimClipStart.mockImplementationOnce((_id, _start, _anchor, _offset, coordinates) => {
            if (!coordinates) {
                throw new Error('Expected MIDI coordinate preflight output');
            }
            if (refused) {
                coordinates.refused = true;
            }
            return false;
        });
        expect(
            handleTrimClipStart.execute({ type: 'trimClipStart', payload: { clipId: 'cm', newStartBeat: 2 } })
        ).toEqual({ status: refused ? 'conflict' : 'no-write' });
    });
});
