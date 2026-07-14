import { describe, it, expect, vi, beforeEach } from 'vitest';

import { copySelectedClip } from '../copySelectedClip';

const mocks = vi.hoisted(() => ({
    workspaceStore: {
        value: null as {
            selectedClipId: string | null;
            selectedClipIds: string[];
        } | null,
    },
    getTrackStoreState: vi.fn(),
    setClipClipboard: vi.fn(),
}));

vi.mock('#/modules/Workspace/stores', () => ({
    workspaceStore: mocks.workspaceStore,
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

describe('copySelectedClip', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.workspaceStore.value = null;
        mocks.getTrackStoreState.mockReturnValue(null);
    });

    it('returns early when workspace is unavailable', () => {
        expect(() => {
            copySelectedClip();
        }).not.toThrow();
    });

    it('copies every selected clip from one track snapshot', () => {
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

        copySelectedClip();

        expect(mocks.getTrackStoreState).toHaveBeenCalledOnce();
        expect(mocks.setClipClipboard).toHaveBeenCalledWith([
            { clip: { id: 'clip-1', type: 'audio' }, midiNotes: undefined, sourceTrackId: 'track-1' },
            { clip: { id: 'clip-2', type: 'audio' }, midiNotes: undefined, sourceTrackId: 'track-1' },
        ]);
    });
});
