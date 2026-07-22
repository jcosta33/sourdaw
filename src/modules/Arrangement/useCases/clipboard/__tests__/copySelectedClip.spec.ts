import { describe, it, expect, vi, beforeEach } from 'vitest';

import { copySelectedClip } from '../copySelectedClip';

const mocks = vi.hoisted(() => ({
    clipSelectionStore: {
        value: null as {
            selectedClipId: string | null;
            selectedClipIds: string[];
        } | null,
    },
    getTrackStoreState: vi.fn(),
    resolveEligibleClipWriteTarget: vi.fn(),
    setClipClipboard: vi.fn(),
}));

vi.mock('../../../stores/clipSelectionStore', () => ({
    clipSelectionStore: mocks.clipSelectionStore,
}));

vi.mock('#/modules/MIDI/stores', () => ({
    midiStore: { value: null },
}));

vi.mock('../../getTrackStoreState', () => ({
    getTrackStoreState: mocks.getTrackStoreState,
}));

vi.mock('../../../stores/clipboardStore', () => ({
    setClipClipboard: mocks.setClipClipboard,
}));

vi.mock('../../../stores/resolveEligibleClipWriteTarget', () => ({
    resolveEligibleClipWriteTarget: mocks.resolveEligibleClipWriteTarget,
}));

describe('copySelectedClip', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.clipSelectionStore.value = null;
        mocks.getTrackStoreState.mockReturnValue(null);
        mocks.resolveEligibleClipWriteTarget.mockImplementation((input: { clipId: string }) => ({
            status: 'eligible',
            clipId: input.clipId,
            trackId: 'track-1',
        }));
    });

    it('returns early when workspace is unavailable', () => {
        expect(copySelectedClip()).toBe(false);
        expect(mocks.setClipClipboard).not.toHaveBeenCalled();
    });

    it('copies every selected clip from one track snapshot', () => {
        mocks.clipSelectionStore.value = {
            selectedClipId: 'clip-1',
            selectedClipIds: ['clip-1', 'clip-2'],
        };
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [
                {
                    id: 'track-1',
                    clips: [
                        { id: 'clip-1', type: 'audio' },
                        { id: 'clip-2', type: 'audio' },
                    ],
                },
            ],
        });

        expect(copySelectedClip()).toBe(true);

        expect(mocks.getTrackStoreState).toHaveBeenCalledOnce();
        expect(mocks.setClipClipboard).toHaveBeenCalledWith([
            { clip: { id: 'clip-1', type: 'audio' }, midiNotes: undefined, sourceTrackId: 'track-1' },
            { clip: { id: 'clip-2', type: 'audio' }, midiNotes: undefined, sourceTrackId: 'track-1' },
        ]);
    });

    it('rejects a mixed valid and ineligible selection before writing the clipboard', () => {
        mocks.clipSelectionStore.value = {
            selectedClipId: 'clip-1',
            selectedClipIds: ['clip-1', 'vca-clip'],
        };
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [{ id: 'track-1', clips: [{ id: 'clip-1', type: 'audio' }] }],
        });
        mocks.resolveEligibleClipWriteTarget.mockImplementation((input: { clipId: string }) => {
            if (input.clipId === 'vca-clip') {
                return { status: 'ineligible' };
            }
            return { status: 'eligible', clipId: input.clipId, trackId: 'track-1' };
        });

        expect(copySelectedClip()).toBe(false);

        expect(mocks.setClipClipboard).not.toHaveBeenCalled();
    });

    it('rejects duplicate selected ids as one malformed operation', () => {
        mocks.clipSelectionStore.value = {
            selectedClipId: 'clip-1',
            selectedClipIds: ['clip-1', 'clip-1'],
        };
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [{ id: 'track-1', clips: [{ id: 'clip-1', type: 'audio' }] }],
        });

        expect(copySelectedClip()).toBe(false);

        expect(mocks.setClipClipboard).not.toHaveBeenCalled();
    });
});
