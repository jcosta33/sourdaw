import { beforeEach, describe, expect, it } from 'vitest';

import { defaultTrackState, sanitizeTrackSnapshot, trackStore } from '#/modules/Arrangement/stores';

import { DEFAULT_CRUST_PATCH } from '../../../models/CrustPatch';
import { crustStore, getCrustState, setCrustParam } from '../../../stores/crustStore';
import { hydrateCrustPatchFromProject } from '../hydrateCrustPatchFromProject';

function projectDevices(
    states: Array<{ id: string; deviceState?: { version: number; data: { disclosureTier: string } } }>
) {
    return sanitizeTrackSnapshot({
        tracks: [
            {
                id: 'track-1',
                name: 'Master',
                kind: 'audio',
                devices: states.map(({ id, deviceState }) => ({
                    id,
                    name: 'Crust',
                    type: 'crust',
                    bypassed: false,
                    parameterValues: {},
                    deviceState,
                })),
            },
        ],
        selectedTrackId: null,
    }).tracks;
}

describe('hydrateCrustPatchFromProject disclosure', () => {
    beforeEach(() => {
        crustStore.set({});
        trackStore.set({
            ...defaultTrackState,
            tracks: projectDevices([
                { id: 'a', deviceState: { version: 1, data: { disclosureTier: 'lab' } } },
                { id: 'b', deviceState: { version: 1, data: { disclosureTier: 'shape' } } },
            ]),
        });
    });

    it('restores distinct persisted tiers for two addressed devices after session state is lost', () => {
        hydrateCrustPatchFromProject('a');
        hydrateCrustPatchFromProject('b');
        expect(getCrustState('a').patch.uiLevel).toBe(5);
        expect(getCrustState('b').patch.uiLevel).toBe(2);
    });
    it('restores absent numeric defaults without resetting nonnumeric state', () => {
        setCrustParam('a', 'gain', 9);
        setCrustParam('a', 'oversampling', 16);
        setCrustParam('a', 'outputBitDepth', 16);
        setCrustParam('a', 'algorithm', 'wall');
        hydrateCrustPatchFromProject('a');
        expect(getCrustState('a').patch).toMatchObject({
            gain: DEFAULT_CRUST_PATCH.gain,
            oversampling: DEFAULT_CRUST_PATCH.oversampling,
            outputBitDepth: DEFAULT_CRUST_PATCH.outputBitDepth,
            algorithm: 'wall',
        });
    });

    it('preserves an explicitly owned sparse preview while hydrating other defaults', () => {
        setCrustParam('a', 'ceiling', -9);
        hydrateCrustPatchFromProject('a', new Map([['gain', 6]]));
        expect(getCrustState('a').patch.gain).toBe(6);
        expect(getCrustState('a').patch.ceiling).toBe(DEFAULT_CRUST_PATCH.ceiling);
        hydrateCrustPatchFromProject('a');
        expect(getCrustState('a').patch.gain).toBe(DEFAULT_CRUST_PATCH.gain);
    });

    it('does not reinterpret invalid present numeric values as absent defaults', () => {
        const current = trackStore.value;
        if (!current) {
            throw new Error('Missing track state');
        }
        trackStore.set({
            ...current,
            tracks: current.tracks.map((track) => ({
                ...track,
                devices: track.devices.map((device) => ({
                    ...device,
                    parameterValues: {
                        gain: Number.NaN,
                        oversampling: 3,
                        outputBitDepth: 17,
                    },
                })),
            })),
        });
        setCrustParam('a', 'gain', 9);
        setCrustParam('a', 'oversampling', 16);
        setCrustParam('a', 'outputBitDepth', 16);
        hydrateCrustPatchFromProject('a');
        expect(getCrustState('a').patch).toMatchObject({ gain: 9, oversampling: 16, outputBitDepth: 16 });
    });
});
