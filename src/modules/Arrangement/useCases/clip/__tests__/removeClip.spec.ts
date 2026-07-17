import { describe, it, expect, vi, beforeEach } from 'vitest';

import { removeClip } from '../removeClip';

type MockTrack = { clips: { id: string }[] };
type MockClipboard = {
    clipClipboard: { clip: { id: string }; sourceTrackId: string }[];
    noteClipboard: null;
};

const mocks = vi.hoisted(() => ({
    mapAllTracks: vi.fn<(updater: (track: MockTrack) => MockTrack) => void>(),
    removeMidiClipData: vi.fn<(clipIds: readonly string[]) => void>(),
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

vi.mock('#/modules/MIDI/useCases', () => ({
    removeMidiClipData: mocks.removeMidiClipData,
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
        mocks.clipboardStore.value = null;
        mocks.clipDragPreviewRef.current = null;
        mocks.activeRecordingRef.current = [];
        mocks.getAutomationLanes.mockReturnValue([]);
    });

    it('removes track data before delegating one MIDI cleanup batch ahead of remaining cleanup', () => {
        removeClip('c1');

        expect(mocks.mapAllTracks).toHaveBeenCalledTimes(1);
        expect(mocks.removeMidiClipData).toHaveBeenCalledTimes(1);
        expect(mocks.removeMidiClipData).toHaveBeenCalledWith(['c1']);

        const mapAllTracksOrder = mocks.mapAllTracks.mock.invocationCallOrder[0] ?? 0;
        const midiCleanupOrder = mocks.removeMidiClipData.mock.invocationCallOrder[0] ?? 0;
        const envelopeCleanupOrder = mocks.removeEnvelope.mock.invocationCallOrder[0] ?? 0;
        const warpCleanupOrder = mocks.removeWarpState.mock.invocationCallOrder[0] ?? 0;
        const automationCleanupOrder = mocks.getAutomationLanes.mock.invocationCallOrder[0] ?? 0;

        expect(mapAllTracksOrder).toBeLessThan(midiCleanupOrder);
        expect(midiCleanupOrder).toBeLessThan(envelopeCleanupOrder);
        expect(envelopeCleanupOrder).toBeLessThan(warpCleanupOrder);
        expect(warpCleanupOrder).toBeLessThan(automationCleanupOrder);

        const mapCall = mocks.mapAllTracks.mock.calls[0];
        if (!mapCall) {
            throw new Error('expected mapAllTracks to have been called');
        }
        const updater = mapCall[0];

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
        const setCall = mocks.clipboardStore.set.mock.calls[0];
        if (!setCall) {
            throw new Error('expected clipboardStore.set to have been called');
        }
        const next = setCall[0];
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
