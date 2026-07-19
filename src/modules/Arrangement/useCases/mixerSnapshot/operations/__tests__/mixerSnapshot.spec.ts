import { describe, it, expect, vi, beforeEach } from 'vitest';

import { mixerSnapshotStore } from '../../../../stores/mixerSnapshotStore';
import { deleteMixerSnapshot } from '../deleteMixerSnapshot';
import { recallMixerSnapshot } from '../recallMixerSnapshot';
import { saveMixerSnapshot } from '../saveMixerSnapshot';

import type * as trackStateRepo from '../../../../repositories/track/getTrackState';
import type * as trackSetRepo from '../../../../repositories/track/setTrackState';

const mocks = vi.hoisted(() => ({
    getTrackState: vi.fn<() => (typeof trackStateRepo)['getTrackState'] extends () => infer R ? R : never>(),
    setTrackState: vi.fn<(typeof trackSetRepo)['setTrackState']>(),
}));

vi.mock('../../../../repositories/track/getTrackState', () => ({ getTrackState: mocks.getTrackState }));
vi.mock('../../../../repositories/track/setTrackState', () => ({ setTrackState: mocks.setTrackState }));

const make_tracks = () => [
    {
        id: 't1',
        name: 'Drums',
        gain: 0.8,
        pan: 0,
        muted: false,
        soloed: false,
        clips: [],
        devices: [],
        alternatives: [],
        kind: 'audio' as const,
    },
    {
        id: 't2',
        name: 'Bass',
        gain: 0.6,
        pan: -0.3,
        muted: true,
        soloed: false,
        clips: [],
        devices: [],
        alternatives: [],
        kind: 'audio' as const,
    },
];

describe('saveMixerSnapshot', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mixerSnapshotStore.set({ snapshots: [] });
    });

    it('returns null when no track state', () => {
        mocks.getTrackState.mockReturnValue(null);
        expect(saveMixerSnapshot('Test')).toBeNull();
    });

    it('creates snapshot with channel data from tracks', () => {
        mocks.getTrackState.mockReturnValue({ tracks: make_tracks(), selectedTrackId: 't1' } as never);
        const snap = saveMixerSnapshot('My Snap');
        expect(snap).not.toBeNull();
        expect(snap!.id).toMatch(/^snap-/);
        expect(snap!.name).toBe('My Snap');
        expect(snap!.channels).toHaveLength(2);
        expect(snap!.channels[0]).toMatchObject({ trackId: 't1', gain: 0.8, pan: 0, muted: false, soloed: false });
        expect(snap!.channels[1]).toMatchObject({ trackId: 't2', gain: 0.6, pan: -0.3, muted: true, soloed: false });
    });

    it('adds snapshot to store', () => {
        mocks.getTrackState.mockReturnValue({ tracks: make_tracks(), selectedTrackId: 't1' } as never);
        const snap = saveMixerSnapshot('Snap 1');
        expect(mixerSnapshotStore.value!.snapshots).toHaveLength(1);
        expect(mixerSnapshotStore.value!.snapshots[0]).toBe(snap);
    });

    it('appends to existing snapshots', () => {
        mocks.getTrackState.mockReturnValue({ tracks: make_tracks(), selectedTrackId: 't1' } as never);
        saveMixerSnapshot('Snap 1');
        saveMixerSnapshot('Snap 2');
        expect(mixerSnapshotStore.value!.snapshots).toHaveLength(2);
        expect(mixerSnapshotStore.value!.snapshots.map((s) => s.name)).toEqual(['Snap 1', 'Snap 2']);
    });
});

describe('recallMixerSnapshot', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mixerSnapshotStore.set({ snapshots: [] });
    });

    it('returns null when snapshot not found', () => {
        mocks.getTrackState.mockReturnValue({ tracks: make_tracks(), selectedTrackId: 't1' } as never);
        expect(recallMixerSnapshot('nonexistent')).toBeNull();
    });

    it('returns null when no track state', () => {
        mocks.getTrackState.mockReturnValue(null);
        expect(recallMixerSnapshot('any')).toBeNull();
    });

    it('restores channel values and returns previous state', () => {
        const tracks = make_tracks();
        mocks.getTrackState.mockReturnValue({ tracks, selectedTrackId: 't1' } as never);
        const snap = saveMixerSnapshot('Baseline');

        // Mutate tracks
        mocks.getTrackState.mockReturnValue({
            tracks: [
                { ...tracks[0]!, gain: 1.0, muted: true },
                { ...tracks[1]!, gain: 0.1 },
            ],
            selectedTrackId: 't1',
        } as never);

        const previous = recallMixerSnapshot(snap!.id);
        expect(previous).not.toBeNull();
        expect(previous![0]).toMatchObject({ trackId: 't1', gain: 1.0, muted: true });
        expect(mocks.setTrackState).toHaveBeenCalled();
    });
});

describe('deleteMixerSnapshot', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mixerSnapshotStore.set({ snapshots: [] });
    });

    it('removes snapshot by id', () => {
        mocks.getTrackState.mockReturnValue({ tracks: make_tracks(), selectedTrackId: 't1' } as never);
        const snap1 = saveMixerSnapshot('A');
        saveMixerSnapshot('B');
        expect(mixerSnapshotStore.value!.snapshots).toHaveLength(2);

        deleteMixerSnapshot(snap1!.id);
        expect(mixerSnapshotStore.value!.snapshots).toHaveLength(1);
        expect(mixerSnapshotStore.value!.snapshots[0]!.name).toBe('B');
    });

    it('does nothing when snapshot not found', () => {
        mocks.getTrackState.mockReturnValue({ tracks: make_tracks(), selectedTrackId: 't1' } as never);
        saveMixerSnapshot('A');
        deleteMixerSnapshot('nonexistent');
        expect(mixerSnapshotStore.value!.snapshots).toHaveLength(1);
    });
});
