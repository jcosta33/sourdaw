import { beforeEach, describe, expect, it, vi } from 'vitest';

import { removeClipSatelliteData } from '../removeClipSatelliteData';

type MockClipboard = {
    clipClipboard: { clip: { id: string }; sourceTrackId: string }[];
    noteClipboard: null;
};

const mocks = vi.hoisted(() => ({
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

describe('removeClipSatelliteData', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.clipboardStore.value = null;
        mocks.clipDragPreviewRef.current = null;
        mocks.activeRecordingRef.current = [];
        mocks.getAutomationLanes.mockReturnValue([]);
    });

    it('retires every satellite of every clip id in one pass', () => {
        mocks.getAutomationLanes.mockReturnValue([
            { id: 'lane-c1', clipId: 'c1' },
            { id: 'lane-c2', clipId: 'c2' },
            { id: 'lane-survivor', clipId: 'c3' },
            { id: 'lane-track', clipId: undefined },
        ]);
        mocks.clipboardStore.value = {
            clipClipboard: [
                { clip: { id: 'c1' }, sourceTrackId: 't1' },
                { clip: { id: 'c2' }, sourceTrackId: 't1' },
                { clip: { id: 'c3' }, sourceTrackId: 't1' },
            ],
            noteClipboard: null,
        };
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
        expect(mocks.clipboardStore.set).toHaveBeenCalledTimes(1);
        expect(mocks.clipboardStore.set.mock.calls[0]?.[0].clipClipboard).toEqual([
            { clip: { id: 'c3' }, sourceTrackId: 't1' },
        ]);
        expect([...positions.keys()]).toEqual(['c3']);
        expect(originals.size).toBe(0);
        expect(mocks.activeRecordingRef.current).toEqual(['c3']);
    });

    it('does no work for an empty clip id list', () => {
        mocks.getAutomationLanes.mockReturnValue([{ id: 'lane-track', clipId: undefined }]);
        mocks.clipboardStore.value = {
            clipClipboard: [{ clip: { id: 'c1' }, sourceTrackId: 't1' }],
            noteClipboard: null,
        };

        removeClipSatelliteData([]);

        expect(mocks.getAutomationLanes).not.toHaveBeenCalled();
        expect(mocks.removeEnvelope).not.toHaveBeenCalled();
        expect(mocks.removeWarpState).not.toHaveBeenCalled();
        expect(mocks.clipboardStore.set).not.toHaveBeenCalled();
    });

    it('leaves the clipboard alone when no entry names a retired clip', () => {
        mocks.clipboardStore.value = {
            clipClipboard: [{ clip: { id: 'c9' }, sourceTrackId: 't1' }],
            noteClipboard: null,
        };

        removeClipSatelliteData(['c1']);

        expect(mocks.clipboardStore.set).not.toHaveBeenCalled();
    });

    it('removes each satellite once for a repeated clip id', () => {
        removeClipSatelliteData(['c1', 'c1']);

        expect(mocks.removeEnvelope.mock.calls).toEqual([['c1']]);
        expect(mocks.removeWarpState.mock.calls).toEqual([['c1']]);
    });
});
