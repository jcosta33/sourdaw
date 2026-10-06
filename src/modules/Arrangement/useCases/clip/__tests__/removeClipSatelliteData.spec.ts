import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type Clip } from '../../../models/Track';
import { clipboardStore } from '../../../stores/clipboardStore';
import { removeClipSatelliteData } from '../removeClipSatelliteData';

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
    removeEnvelope: vi.fn(),
    removeWarpState: vi.fn(),
    getAutomationLanes: vi.fn(() => [] as { id: string; clipId?: string }[]),
    removeAutomationLane: vi.fn(),
    clipDragPreviewRef: {
        current: null as { positions: Map<string, unknown>; originals: Map<string, unknown> } | null,
    },
    activeRecordingRef: { current: [] as string[] },
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

describe('removeClipSatelliteData', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.clipDragPreviewRef.current = null;
        mocks.activeRecordingRef.current = [];
        mocks.getAutomationLanes.mockReturnValue([]);
        clipboardStore.set({ clipClipboard: [], noteClipboard: null });
    });

    it('retires every satellite of every clip id in one pass', () => {
        mocks.getAutomationLanes.mockReturnValue([
            { id: 'lane-c1', clipId: 'c1' },
            { id: 'lane-c2', clipId: 'c2' },
            { id: 'lane-survivor', clipId: 'c3' },
            { id: 'lane-track', clipId: undefined },
        ]);
        const positions = new Map<string, unknown>([
            ['c1', {}],
            ['c3', {}],
        ]);
        const originals = new Map<string, unknown>([['c2', {}]]);
        mocks.clipDragPreviewRef.current = { positions, originals };
        mocks.activeRecordingRef.current = ['c1', 'c3'];

        removeClipSatelliteData(['c1', 'c2']);

        expect(mocks.removeEnvelope.mock.calls).toEqual([['c1'], ['c2']]);
        expect(mocks.removeWarpState.mock.calls).toEqual([['c1'], ['c2']]);
        expect(mocks.removeAutomationLane.mock.calls).toEqual([['lane-c1'], ['lane-c2']]);
        expect([...positions.keys()]).toEqual(['c3']);
        expect(originals.size).toBe(0);
        expect(mocks.activeRecordingRef.current).toEqual(['c3']);
    });

    it('does no work for an empty clip id list', () => {
        mocks.getAutomationLanes.mockReturnValue([{ id: 'lane-track', clipId: undefined }]);

        removeClipSatelliteData([]);

        expect(mocks.getAutomationLanes).not.toHaveBeenCalled();
        expect(mocks.removeEnvelope).not.toHaveBeenCalled();
        expect(mocks.removeWarpState).not.toHaveBeenCalled();
    });

    it('leaves the clipboard untouched: the entry a retired clip was copied into survives', () => {
        // A clipboard entry is a self-contained snapshot (clip fields, notes,
        // satellites read at copy time), so retiring the source must not
        // invalidate it — copy, delete, paste still lands what the copy caught.
        clipboardStore.set({
            clipClipboard: [
                { clip: clipboardClip('c1'), automationLanes: [], sourceTrackId: 't1' },
                { clip: clipboardClip('c2'), automationLanes: [], sourceTrackId: 't1' },
            ],
            noteClipboard: null,
        });

        removeClipSatelliteData(['c1']);

        expect(clipboardStore.value?.clipClipboard.map((entry) => entry.clip.id)).toEqual(['c1', 'c2']);
    });

    it('removes each satellite once for a repeated clip id', () => {
        removeClipSatelliteData(['c1', 'c1']);

        expect(mocks.removeEnvelope.mock.calls).toEqual([['c1']]);
        expect(mocks.removeWarpState.mock.calls).toEqual([['c1']]);
    });
});
