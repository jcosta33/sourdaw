import { describe, it, expect, vi, beforeEach } from 'vitest';

import { removeClip } from '../removeClip';

type MockTrack = { clips: { id: string }[] };
type MockClipboard = {
    clipClipboard: { clip: { id: string }; sourceTrackId: string }[];
    noteClipboard: null;
};

const mocks = vi.hoisted(() => ({
    mapAllTracks: vi.fn<(updater: (track: MockTrack) => MockTrack) => void>(),
    midiStore: { value: null as unknown, set: vi.fn() },
    removeEnvelope: vi.fn(),
    removeWarpState: vi.fn(),
    getAutomationLanes: vi.fn(() => [] as { id: string; clipId?: string }[]),
    removeAutomationLane: vi.fn(),
    clipboardStore: { value: null as MockClipboard | null, set: vi.fn<(state: MockClipboard) => void>() },
    clipDragPreviewRef: {
        current: null as { positions: Map<string, unknown>; originals: Map<string, unknown> } | null,
    },
    activeRecordingRef: { current: [] as string[] },
}));

vi.mock('#/modules/Arrangement/repositories/track/mapAllTracks', () => ({
    mapAllTracks: mocks.mapAllTracks,
}));

vi.mock('#/modules/MIDI/stores', () => ({
    midiStore: mocks.midiStore,
}));

vi.mock('#/modules/Automation/useCases', () => ({
    getAutomationLanes: mocks.getAutomationLanes,
    removeAutomationLane: mocks.removeAutomationLane,
}));

vi.mock('../../../stores/gainEnvelopeStore', () => ({
    removeEnvelope: mocks.removeEnvelope,
}));

vi.mock('../../../stores/warpStates', () => ({
    removeWarpState: mocks.removeWarpState,
}));

vi.mock('../../../stores/clipboardStore', () => ({
    clipboardStore: mocks.clipboardStore,
}));

vi.mock('../../../stores/clipDragPreviewRef', () => ({
    clipDragPreviewRef: mocks.clipDragPreviewRef,
}));

vi.mock('../../../stores/activeRecordingRef', () => ({
    activeRecordingRef: mocks.activeRecordingRef,
}));

describe('removeClip', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.midiStore.value = null;
        mocks.clipboardStore.value = null;
        mocks.clipDragPreviewRef.current = null;
        mocks.activeRecordingRef.current = [];
        mocks.getAutomationLanes.mockReturnValue([]);
    });

    it('delegates to mapAllTracks with a filter function', () => {
        removeClip('c1');

        expect(mocks.mapAllTracks).toHaveBeenCalledTimes(1);
        const updater = mocks.mapAllTracks.mock.calls[0][0];

        const mockTrack = { clips: [{ id: 'c1' }, { id: 'c2' }] };
        const updatedTrack = updater(mockTrack);
        expect(updatedTrack.clips).toEqual([{ id: 'c2' }]);
    });

    it('drops the gain envelope and warp state keyed by the clip', () => {
        removeClip('c1');

        expect(mocks.removeEnvelope).toHaveBeenCalledWith('c1');
        expect(mocks.removeWarpState).toHaveBeenCalledWith('c1');
    });

    it('removes only clip-scoped automation lanes for the removed clip', () => {
        mocks.getAutomationLanes.mockReturnValue([
            { id: 'lane-clip', clipId: 'c1' },
            { id: 'lane-other-clip', clipId: 'c2' },
            { id: 'lane-track', clipId: undefined },
        ]);

        removeClip('c1');

        expect(mocks.removeAutomationLane).toHaveBeenCalledTimes(1);
        expect(mocks.removeAutomationLane).toHaveBeenCalledWith('lane-clip');
    });

    it('removes a clipboard entry that points at the removed clip', () => {
        mocks.clipboardStore.value = {
            clipClipboard: [
                { clip: { id: 'c1' }, sourceTrackId: 't1' },
                { clip: { id: 'c2' }, sourceTrackId: 't1' },
            ],
            noteClipboard: null,
        };

        removeClip('c1');

        expect(mocks.clipboardStore.set).toHaveBeenCalledTimes(1);
        const next = mocks.clipboardStore.set.mock.calls[0][0];
        expect(next.clipClipboard).toEqual([{ clip: { id: 'c2' }, sourceTrackId: 't1' }]);
    });

    it('does not rewrite the clipboard when no entry matches', () => {
        mocks.clipboardStore.value = {
            clipClipboard: [{ clip: { id: 'c2' }, sourceTrackId: 't1' }],
            noteClipboard: null,
        };

        removeClip('c1');

        expect(mocks.clipboardStore.set).not.toHaveBeenCalled();
    });

    it('clears the drag-preview ref entries for the removed clip', () => {
        const positions = new Map([['c1', {}]]);
        const originals = new Map([['c1', {}]]);
        mocks.clipDragPreviewRef.current = { positions, originals };

        removeClip('c1');

        expect(positions.has('c1')).toBe(false);
        expect(originals.has('c1')).toBe(false);
    });

    it('stops tracking the clip as actively recording', () => {
        mocks.activeRecordingRef.current = ['c1', 'c2'];

        removeClip('c1');

        expect(mocks.activeRecordingRef.current).toEqual(['c2']);
    });
});
