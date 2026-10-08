import { describe, it, expect, vi, beforeEach } from 'vitest';

import { createTake, createTakeLane } from '../../../models/TakeLane';
import { type Clip } from '../../../models/Track';
import { clipboardStore } from '../../../stores/clipboardStore';
import { type TakeLaneStoreState } from '../../../stores/takeLaneStore';
import { removeClip } from '../removeClip';

type MockTrack = { clips: { id: string }[] };

function clipboardClip(id: string): Clip {
    return {
        id,
        trackId: 't1',
        name: id,
        startBeat: 0,
        endBeat: 4,
        type: 'audio',
        fadeInBeats: 0,
        fadeOutBeats: 0,
        gain: 1,
        color: '',
        locked: false,
        muted: false,
    };
}

const mocks = vi.hoisted(() => ({
    mapAllTracks: vi.fn<(updater: (track: MockTrack) => MockTrack) => void>(),
    removeMidiClipData: vi.fn<(clipIds: readonly string[]) => void>(),
    removeEnvelope: vi.fn(),
    removeWarpState: vi.fn(),
    getAutomationLanes: vi.fn(() => [] as { id: string; clipId?: string }[]),
    removeAutomationLane: vi.fn(),
    clipDragPreviewRef: {
        current: null as { positions: Map<string, unknown>; originals: Map<string, unknown> } | null,
    },
    activeRecordingRef: { current: [] as string[] },
    takeLaneStoreValue: { value: null as TakeLaneStoreState | null },
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

vi.mock('../../../stores/clipDragPreviewRef', () => ({
    clipDragPreviewRef: mocks.clipDragPreviewRef,
}));

vi.mock('../../../stores/activeRecordingRef', () => ({
    activeRecordingRef: mocks.activeRecordingRef,
}));

vi.mock('../../../stores/takeLaneStore', () => ({
    takeLaneStore: {
        get value() {
            return mocks.takeLaneStoreValue.value;
        },
        set: vi.fn((state: TakeLaneStoreState) => {
            mocks.takeLaneStoreValue.value = state;
        }),
    },
}));

describe('removeClip', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.clipDragPreviewRef.current = null;
        mocks.activeRecordingRef.current = [];
        mocks.getAutomationLanes.mockReturnValue([]);
        mocks.takeLaneStoreValue.value = null;
        clipboardStore.set({ clipClipboard: [], noteClipboard: null });
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

    it('keeps the clipboard entry naming the removed clip (the entry is a capture-at-copy snapshot)', () => {
        // A clipboard entry is self-contained — clip fields, notes and
        // satellites read at copy time — so deleting the source must not
        // invalidate it: copy, delete, paste still lands what the copy caught.
        clipboardStore.set({
            clipClipboard: [
                { clip: clipboardClip('c1'), automationLanes: [], sourceTrackId: 't1' },
                { clip: clipboardClip('c2'), automationLanes: [], sourceTrackId: 't1' },
            ],
            noteClipboard: null,
        });

        removeClip('c1');

        expect(clipboardStore.value?.clipClipboard.map((entry) => entry.clip.id)).toEqual(['c1', 'c2']);
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

    it('retires the take and lane that referenced a removed clip (#4265)', () => {
        const take = createTake('c1', 'Take 1', 0, 4);
        mocks.takeLaneStoreValue.value = { lanes: [{ ...createTakeLane('t1'), takes: [take] }] };

        removeClip('c1');

        expect(mocks.takeLaneStoreValue.value).toEqual({ lanes: [] });
    });
});
