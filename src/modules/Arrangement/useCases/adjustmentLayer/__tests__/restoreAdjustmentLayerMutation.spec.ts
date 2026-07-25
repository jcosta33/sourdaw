import { describe, it, expect, vi, beforeEach } from 'vitest';

import { type AdjustmentLayerState, type AdjustmentLayer } from '../../../stores/adjustmentLayer';
import { type TrackStoreState, type Track } from '../../../stores/trackStore';
import { restoreAdjustmentLayerMutation } from '../restoreAdjustmentLayerMutation';

type RestorePayload = {
    layers: AdjustmentLayer[];
    expectedLayersFingerprint: string;
    freezeTransitions: Array<{
        trackId: string;
        previousStatus: 'frozen';
        expectedSourceSignature: string;
    }>;
};

const mocks = vi.hoisted(() => ({
    layerValue: { value: null as AdjustmentLayerState | null },
    layerSet: vi.fn<(value: AdjustmentLayerState | null) => void>(),
    trackValue: { value: null as TrackStoreState | null },
    trackSet: vi.fn<(value: TrackStoreState | null) => void>(),
}));

vi.mock('../../../stores/adjustmentLayer', () => ({
    adjustmentLayerStore: {
        get value() {
            return mocks.layerValue.value;
        },
        set: mocks.layerSet,
    },
}));

vi.mock('../../../stores/trackStore', () => ({
    trackStore: {
        get value() {
            return mocks.trackValue.value;
        },
        set: mocks.trackSet,
    },
}));

function makeTrack(id: string, status: Track['freezeState']['status']): Track {
    return {
        id,
        name: id,
        kind: 'audio',
        clips: [
            {
                id: `${id}-clip`,
                trackId: id,
                name: 'c',
                startBeat: 0,
                endBeat: 4,
                type: 'audio',
                assetHash: 'hash',
                gain: 1,
                fadeInBeats: 0,
                fadeOutBeats: 0,
                color: '',
                locked: false,
                muted: false,
            },
        ],
        devices: [{ id: 'd1', type: 'gain', parameterValues: { gain: 1 }, bypassed: false }],
        freezeState: { status },
        color: '',
        muted: false,
        soloed: false,
        height: 80,
        volume: 1,
        pan: 0,
        automationMode: 'read',
    } as unknown as Track;
}

describe('restoreAdjustmentLayerMutation', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.layerValue.value = { layers: [] };
        mocks.trackValue.value = { tracks: [], selectedTrackId: null, ghostClips: [] };
    });

    it('throws when the current layers fingerprint does not match the committed one', () => {
        mocks.layerValue.value = { layers: [] };
        const payload: RestorePayload = {
            layers: [],
            expectedLayersFingerprint: 'different',
            freezeTransitions: [],
        };

        expect(() => restoreAdjustmentLayerMutation(payload)).toThrow('changed after this action');
        expect(mocks.layerSet).not.toHaveBeenCalled();
    });

    it('restores layers and returns early when there is no track state', () => {
        mocks.layerValue.value = { layers: [] };
        mocks.trackValue.value = null;
        const payload: RestorePayload = {
            layers: [],
            expectedLayersFingerprint: JSON.stringify([]),
            freezeTransitions: [],
        };

        restoreAdjustmentLayerMutation(payload);

        expect(mocks.layerSet).toHaveBeenCalledWith({ layers: [] });
        expect(mocks.trackSet).not.toHaveBeenCalled();
    });

    it('restores a stale track to its previous freeze status when its source signature is unchanged', () => {
        const track = makeTrack('t1', 'stale');
        mocks.trackValue.value = { tracks: [track], selectedTrackId: null, ghostClips: [] };
        mocks.layerValue.value = { layers: [] };
        const sourceSignature = createTrackFreezeSourceSignatureFor(track);
        const payload: RestorePayload = {
            layers: [],
            expectedLayersFingerprint: JSON.stringify([]),
            freezeTransitions: [{ trackId: 't1', previousStatus: 'frozen', expectedSourceSignature: sourceSignature }],
        };

        restoreAdjustmentLayerMutation(payload);

        const newState = mocks.trackSet.mock.calls[0]?.[0] as TrackStoreState | undefined;
        expect(newState?.tracks[0]?.freezeState.status).toBe('frozen');
    });

    it('leaves a stale track stale when its source signature changed since the transition was recorded', () => {
        const track = makeTrack('t1', 'stale');
        mocks.trackValue.value = { tracks: [track], selectedTrackId: null, ghostClips: [] };
        mocks.layerValue.value = { layers: [] };
        const payload: RestorePayload = {
            layers: [],
            expectedLayersFingerprint: JSON.stringify([]),
            freezeTransitions: [{ trackId: 't1', previousStatus: 'frozen', expectedSourceSignature: 'stale-mismatch' }],
        };

        restoreAdjustmentLayerMutation(payload);

        // no transition applied and not frozen → unchanged → set not called
        expect(mocks.trackSet).not.toHaveBeenCalled();
    });

    it('marks a frozen track stale when its effective layer signature differs from the restored one', () => {
        const track = makeTrack('t1', 'frozen');
        mocks.trackValue.value = { tracks: [track], selectedTrackId: null, ghostClips: [] };
        // before has an affecting layer; restored removes it → signature changes
        const affectingLayer: AdjustmentLayer = {
            id: 'L',
            name: 'EQ',
            effectType: 'eq',
            parameters: [{ name: 'Gain', value: 6, min: -12, max: 12, unit: 'dB' }],
            affectedTrackIds: ['t1'],
            insertionIndex: 0,
            regions: [],
            enabled: true,
            mix: 1,
            color: '#fff',
        };
        mocks.layerValue.value = { layers: [affectingLayer] };
        const payload: RestorePayload = {
            layers: [],
            expectedLayersFingerprint: JSON.stringify([affectingLayer]),
            freezeTransitions: [],
        };

        restoreAdjustmentLayerMutation(payload);

        const newState = mocks.trackSet.mock.calls[0]?.[0] as TrackStoreState | undefined;
        expect(newState?.tracks[0]?.freezeState.status).toBe('stale');
    });

    it('keeps a frozen track frozen when the effective signature is unchanged on restore', () => {
        const track = makeTrack('t1', 'frozen');
        mocks.trackValue.value = { tracks: [track], selectedTrackId: null, ghostClips: [] };
        mocks.layerValue.value = { layers: [] };
        const payload: RestorePayload = {
            layers: [],
            expectedLayersFingerprint: JSON.stringify([]),
            freezeTransitions: [],
        };

        restoreAdjustmentLayerMutation(payload);

        expect(mocks.trackSet).not.toHaveBeenCalled();
    });

    it('leaves non-frozen, non-transition tracks untouched', () => {
        const track = makeTrack('t1', 'unfrozen');
        mocks.trackValue.value = { tracks: [track], selectedTrackId: null, ghostClips: [] };
        mocks.layerValue.value = { layers: [] };
        const payload: RestorePayload = {
            layers: [],
            expectedLayersFingerprint: JSON.stringify([]),
            freezeTransitions: [],
        };

        restoreAdjustmentLayerMutation(payload);

        expect(mocks.trackSet).not.toHaveBeenCalled();
    });
});

// Local copy of the source-signature logic so the test derives expected values
// from the domain rather than hard-coding a brittle string.
function createTrackFreezeSourceSignatureFor(source: {
    clips: { id: string; startBeat: number; endBeat: number; assetHash?: string; gain: number }[];
    devices: { id: string; type: string; parameterValues: Record<string, number>; bypassed: boolean }[];
}): string {
    const clipSignatures = [...source.clips]
        .sort((a, b) => a.startBeat - b.startBeat || a.id.localeCompare(b.id))
        .map((clip) => {
            const duration = clip.endBeat - clip.startBeat;
            return `${clip.id}:${clip.startBeat}:${duration}:${clip.assetHash ?? ''}:${clip.gain}`;
        });
    const deviceSignatures = source.devices.map((device) => {
        const parameters = Object.entries(device.parameterValues)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([name, value]) => `${name}=${value}`)
            .join(',');
        return `${device.id}:${device.type}:${parameters}:${device.bypassed}`;
    });
    return `${clipSignatures.join('|')}||${deviceSignatures.join('|')}`;
}
