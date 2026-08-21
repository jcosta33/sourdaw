import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handlePasteClip } from '../handlePasteClip';

const mocks = vi.hoisted(() => ({
    pasteClip: vi.fn(),
    captureTrackClipStates: vi.fn(),
    getTrackStoreState: vi.fn(),
    clipboardStoreValue: null as { clipClipboard: Array<{ sourceTrackId: string }> } | null,
}));

vi.mock('../../../useCases/clipboard/pasteClip', () => ({
    pasteClip: mocks.pasteClip,
}));

vi.mock('../../../useCases/captureTrackClipStates', () => ({
    captureTrackClipStates: mocks.captureTrackClipStates,
}));

vi.mock('../../../useCases/getTrackStoreState', () => ({
    getTrackStoreState: mocks.getTrackStoreState,
}));

vi.mock('../../../stores/clipboardStore', () => ({
    clipboardStore: {
        get value() {
            return mocks.clipboardStoreValue;
        },
    },
}));

describe('handlePasteClip', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.pasteClip.mockReturnValue(true);
        mocks.clipboardStoreValue = null;
        mocks.getTrackStoreState.mockReturnValue(null);
    });

    describe('execute', () => {
        it('returns written only when pasteClip writes', () => {
            expect(handlePasteClip.execute({ type: 'pasteClip' })).toEqual({ status: 'written' });
            expect(mocks.pasteClip).toHaveBeenCalledTimes(1);

            mocks.pasteClip.mockReturnValue(false);
            expect(handlePasteClip.execute({ type: 'pasteClip' })).toEqual({ status: 'no-write' });
        });
    });

    describe('describe', () => {
        it('emits a null inverse action when the clipboard is empty', () => {
            mocks.clipboardStoreValue = { clipClipboard: [] };

            const desc = handlePasteClip.describe({ type: 'pasteClip' });

            expect(desc.label).toBe('Paste clip');
            expect(desc.inverseAction).toBeNull();
            expect(mocks.captureTrackClipStates).not.toHaveBeenCalled();
        });

        it('emits a null inverse action when the track store is unavailable', () => {
            mocks.clipboardStoreValue = { clipClipboard: [{ sourceTrackId: 't1' }] };
            mocks.getTrackStoreState.mockReturnValue(null);

            const desc = handlePasteClip.describe({ type: 'pasteClip' });

            expect(desc.inverseAction).toBeNull();
            expect(mocks.captureTrackClipStates).not.toHaveBeenCalled();
        });

        it('resolves distinct target tracks: selectedTrackId when set, else each entry source track', () => {
            mocks.clipboardStoreValue = {
                clipClipboard: [{ sourceTrackId: 't-source-one' }, { sourceTrackId: 't-source-two' }],
            };
            mocks.getTrackStoreState.mockReturnValue({ selectedTrackId: null, tracks: [] });
            mocks.captureTrackClipStates.mockReturnValue([]);

            handlePasteClip.describe({ type: 'pasteClip' });

            expect(mocks.captureTrackClipStates).toHaveBeenCalledWith(
                expect.arrayContaining(['t-source-one', 't-source-two'])
            );
            expect(mocks.captureTrackClipStates.mock.calls[0]?.[0]).toHaveLength(2);
        });

        it('collapses to the one selected track when selectedTrackId overrides every entry', () => {
            mocks.clipboardStoreValue = {
                clipClipboard: [{ sourceTrackId: 't-source-one' }, { sourceTrackId: 't-source-two' }],
            };
            mocks.getTrackStoreState.mockReturnValue({ selectedTrackId: 'selected-track', tracks: [] });
            mocks.captureTrackClipStates.mockReturnValue([]);

            handlePasteClip.describe({ type: 'pasteClip' });

            expect(mocks.captureTrackClipStates).toHaveBeenCalledWith(['selected-track']);
        });
    });

    it('round-trips: the inverse restores the pre-paste clips, and redo re-applies the pasted clips', () => {
        mocks.clipboardStoreValue = { clipClipboard: [{ sourceTrackId: 't1' }] };
        mocks.getTrackStoreState.mockReturnValue({ selectedTrackId: null, tracks: [] });
        const prePasteState = [
            { trackId: 't1', clips: [], midiNotesByClipId: {}, midiCcByClipId: {}, midiPitchBendByClipId: {} },
        ];
        const postPasteState = [
            {
                trackId: 't1',
                clips: [{ id: 'pasted-clip', trackId: 't1', startBeat: 0, endBeat: 4 }],
                midiNotesByClipId: {},
                midiCcByClipId: {},
                midiPitchBendByClipId: {},
            },
        ];
        mocks.captureTrackClipStates.mockReturnValueOnce(prePasteState).mockReturnValueOnce(postPasteState);

        const action = { type: 'pasteClip' as const };
        const desc = handlePasteClip.describe(action);
        if (!desc.inverseAction || desc.inverseAction.type !== 'restoreTrackClipStates') {
            throw new Error('expected a restoreTrackClipStates inverse action');
        }
        if (!desc.redoAction || desc.redoAction.type !== 'restoreTrackClipStates') {
            throw new Error('expected a restoreTrackClipStates redo action');
        }

        expect(desc.inverseAction.payload.expected).toEqual([]);

        const result = handlePasteClip.execute(action);

        expect(result).toEqual({ status: 'written' });
        expect(mocks.captureTrackClipStates).toHaveBeenLastCalledWith(['t1']);
        expect(desc.inverseAction.payload.expected).toEqual(postPasteState);
        expect(desc.inverseAction.payload.replacement).toEqual(prePasteState);
        expect(desc.redoAction.payload.expected).toEqual(prePasteState);
        expect(desc.redoAction.payload.replacement).toEqual(postPasteState);
    });

    it('is undoable', () => {
        expect(handlePasteClip.undoable).toBe(true);
    });
});
