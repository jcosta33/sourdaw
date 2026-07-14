import { describe, it, expect, vi, beforeEach } from 'vitest';

import { cutSelectedClip } from '../cutSelectedClip';

const mocks = vi.hoisted(() => ({
    workspaceStore: {
        value: null as {
            selectedClipId: string | null;
            selectedClipIds: string[];
        } | null,
    },
    getTrackStoreState: vi.fn(),
    removeClip: vi.fn(),
    setClipClipboard: vi.fn(),
}));

vi.mock('#/modules/Workspace/stores', () => ({
    workspaceStore: mocks.workspaceStore,
}));

vi.mock('#/modules/MIDI/stores', () => ({
    midiStore: { value: null },
}));

vi.mock('../../clip/removeClip', () => ({
    removeClip: mocks.removeClip,
}));

vi.mock('../../getTrackStoreState', () => ({
    getTrackStoreState: mocks.getTrackStoreState,
}));

vi.mock('../../../stores/clipboardStore', () => ({
    setClipClipboard: mocks.setClipClipboard,
}));

describe('cutSelectedClip', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.workspaceStore.value = null;
        mocks.getTrackStoreState.mockReturnValue(null);
    });

    it('returns early when workspace is unavailable without calling removeClip', () => {
        cutSelectedClip();

        expect(mocks.removeClip).not.toHaveBeenCalled();
    });

    it('captures populated track state and commits the clipboard after removing every selected clip', () => {
        mocks.workspaceStore.value = {
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

        cutSelectedClip();

        expect(mocks.removeClip).toHaveBeenNthCalledWith(1, 'clip-1');
        expect(mocks.removeClip).toHaveBeenNthCalledWith(2, 'clip-2');
        expect(mocks.setClipClipboard).toHaveBeenCalledWith([
            { clip: { id: 'clip-1', type: 'audio' }, midiNotes: undefined, sourceTrackId: 'track-1' },
            { clip: { id: 'clip-2', type: 'audio' }, midiNotes: undefined, sourceTrackId: 'track-1' },
        ]);
        expect(mocks.removeClip.mock.invocationCallOrder[1]).toBeLessThan(
            mocks.setClipClipboard.mock.invocationCallOrder[0]!
        );
    });
});
