import { describe, it, expect, vi, beforeEach } from 'vitest';

import { ClipDummy } from '../../../__tests__/ClipDummy';
import { type Clip } from '../../../models/Track';
import { handleSlipClipContent } from '../handleSlipClipContent';

const mocks = vi.hoisted(() => ({
    slipClipContent: vi.fn<typeof import('../../../useCases/clipEditing/slipClipContent').slipClipContent>(),
    getTrackStoreState: vi.fn<
        () => {
            tracks: {
                id: string;
                clips: Clip[];
            }[];
        } | null
    >(),
}));

vi.mock('../../../useCases/clipEditing/slipClipContent', () => ({
    slipClipContent: mocks.slipClipContent,
}));

vi.mock('../../../useCases/getTrackStoreState', () => ({
    getTrackStoreState: mocks.getTrackStoreState,
}));

describe('handleSlipClipContent', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.slipClipContent.mockReset();
        mocks.getTrackStoreState.mockReturnValue(null);
    });

    it('executes slipClipContent with the provided payload', () => {
        void handleSlipClipContent.execute({
            type: 'slipClipContent',
            payload: { clipId: 'c1', clipType: 'midi', offset: 1.5 },
        });

        // A fresh keyless dispatch forwards no recorded lift — the handler
        // passes the payload's field verbatim, so the use-case sees the
        // keyless fresh-action shape, not a zero lift.
        expect(mocks.slipClipContent).toHaveBeenCalledWith('c1', 'midi', 1.5, undefined, { restore: undefined });
    });

    it('provides a description with no inverse when the clip is gone', () => {
        const desc = handleSlipClipContent.describe({
            type: 'slipClipContent',
            payload: { clipId: 'c1', clipType: 'audio', offset: 1.5 },
        });
        expect(desc.label).toBe('Slip clip content');
        expect(desc.inverseAction).toBeNull();
    });

    it('captures exact source presence and both replay directions for audio', () => {
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [
                {
                    id: 't1',
                    clips: [ClipDummy.create({ id: 'c1', trackId: 't1', type: 'audio', audioOffsetBeats: -2 })],
                },
            ],
        });

        const desc = handleSlipClipContent.describe({
            type: 'slipClipContent',
            payload: { clipId: 'c1', clipType: 'audio', offset: 1.5 },
        });

        expect(desc.inverseAction).toMatchObject({
            type: 'restoreAudioClipSlip',
            payload: {
                clipId: 'c1',
                offset: 1.5,
                direction: 'restore',
                before: { clip: { audioOffsetBeats: -2 } },
                after: { clip: { audioOffsetBeats: 1.5, audioOffsetSeconds: 0.75, audioUnwrappedOffsetSeconds: 0.75 } },
            },
        });
        expect(desc.redoAction).toMatchObject({ type: 'restoreAudioClipSlip', payload: { direction: 'apply' } });
    });

    it('records a zero lift on the midi inverse — the restoration key rides every capture', () => {
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [{ id: 't1', clips: [ClipDummy.create({ id: 'cm', type: 'midi' })] }],
        });

        const desc = handleSlipClipContent.describe({
            type: 'slipClipContent',
            payload: { clipId: 'cm', clipType: 'midi', offset: 1 },
        });

        // Zero included: the replay keys verbatim restoration on the key's
        // presence, so a capture that omitted it at lift 0 sent the undo
        // through the fresh wrap law instead of restoring the captured
        // offset (#5198 repair).
        expect(desc.inverseAction).toEqual({
            type: 'slipClipContent',
            payload: { clipId: 'cm', clipType: 'midi', offset: 0, rowLiftBeats: 0 },
        });
    });

    it('is undoable', () => {
        expect(handleSlipClipContent.undoable).toBe(true);
    });

    it('refuses a missing audio source owner before executing the slip', () => {
        expect(
            handleSlipClipContent.execute({
                type: 'slipClipContent',
                payload: { clipId: 'c1', clipType: 'audio', offset: 1 },
            })
        ).toEqual({ status: 'conflict' });
        expect(mocks.slipClipContent).not.toHaveBeenCalled();
    });

    it('records the actual MIDI owner capture and passes reciprocal data on its real inverse', () => {
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [{ id: 't1', clips: [ClipDummy.create({ id: 'cm', trackId: 't1', type: 'midi' })] }],
        });
        const action = {
            type: 'slipClipContent' as const,
            payload: { clipId: 'cm', clipType: 'midi' as const, offset: -1 },
        };
        const description = handleSlipClipContent.describe(action);
        expect(description.redoAction?.type).toBe('slipClipContent');
        expect(description.redoAction?.payload).not.toBe(action.payload);
        const capture = {
            beatDelta: 8,
            coordinates: [{ kind: 'note' as const, id: 'note', beforeBeat: 0.1, afterBeat: 8.1 }],
        };
        mocks.slipClipContent.mockImplementationOnce((_id, _type, _offset, _lift, coordinates) => {
            if (!coordinates) {
                throw new Error('Expected the MIDI coordinate capture output');
            }
            coordinates.capture = capture;
            return true;
        });
        expect(handleSlipClipContent.execute(action)).toEqual({ status: 'written' });
        expect(Object.hasOwn(action.payload, 'midiRowCoordinates')).toBe(false);
        expect(mocks.slipClipContent).toHaveBeenCalledWith('cm', 'midi', -1, undefined, {
            restore: undefined,
            capture,
        });
        expect(description.inverseAction).toMatchObject({ payload: { rowLiftBeats: -8, midiRowCoordinates: capture } });
        if (description.inverseAction?.type !== 'slipClipContent') {
            throw new Error('Expected a slip inverse');
        }
        mocks.slipClipContent.mockReturnValueOnce(true);
        expect(handleSlipClipContent.execute(description.inverseAction)).toEqual({ status: 'written' });
        expect(mocks.slipClipContent).toHaveBeenLastCalledWith('cm', 'midi', 0, -8, { restore: capture });
    });

    it.each([false, true])('distinguishes a fresh MIDI no-write from unsafe coordinate refusal: %s', (refused) => {
        mocks.slipClipContent.mockImplementationOnce((_id, _type, _offset, _lift, coordinates) => {
            if (!coordinates) {
                throw new Error('Expected MIDI coordinate preflight output');
            }
            if (refused) {
                coordinates.refused = true;
            }
            return false;
        });
        expect(
            handleSlipClipContent.execute({
                type: 'slipClipContent',
                payload: { clipId: 'cm', clipType: 'midi', offset: -1 },
            })
        ).toEqual({ status: refused ? 'conflict' : 'no-write' });
    });
});
