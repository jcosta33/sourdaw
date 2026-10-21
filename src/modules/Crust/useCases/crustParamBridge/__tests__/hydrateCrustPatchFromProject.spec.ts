import { beforeEach, describe, expect, it } from 'vitest';

import { defaultTrackState, sanitizeTrackSnapshot, trackStore } from '#/modules/Arrangement/stores';

import { crustStore, getCrustState } from '../../../stores/crustStore';
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
});
