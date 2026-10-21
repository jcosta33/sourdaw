import { beforeEach, describe, expect, it, vi } from 'vitest';

import { defaultTrackState, sanitizeTrackSnapshot, trackStore } from '#/modules/Arrangement/stores';
import { getArrangementHandlers } from '#/modules/Arrangement/useCases';
import { clearHandlerRegistry, registerHandlerMap } from '#/modules/Command/stores';
import { notifyUser } from '#/utils/Notification/notifyUser';

const admission = vi.hoisted(() => ({ reason: null as string | null }));
vi.mock('#/modules/Command/useCases/getProjectMutationAdmissionFailure', () => ({
    getProjectMutationAdmissionFailure: () => admission.reason,
}));
vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: vi.fn() }));

import { crustStore, getCrustState } from '../../stores/crustStore';
import { hydrateCrustPatchFromProject } from '../crustParamBridge/hydrateCrustPatchFromProject';
import { setCrustPanelUiLevel } from '../setCrustPanelUiLevel';

function tracksWithTwoCrustDevices() {
    return sanitizeTrackSnapshot({
        tracks: [
            {
                id: 'track-1',
                name: 'Master',
                kind: 'audio',
                devices: [
                    {
                        id: 'a',
                        name: 'Crust A',
                        type: 'crust',
                        bypassed: false,
                        parameterValues: {},
                        deviceState: { version: 1, data: { unrelated: 'preserve' } },
                    },
                    { id: 'b', name: 'Crust B', type: 'crust', bypassed: false, parameterValues: {} },
                ],
            },
        ],
        selectedTrackId: null,
    }).tracks;
}

function projectState(deviceId: string) {
    return trackStore.value?.tracks.flatMap((track) => track.devices).find((device) => device.id === deviceId)
        ?.deviceState;
}

describe('setCrustPanelUiLevel project path', () => {
    beforeEach(() => {
        admission.reason = null;
        vi.mocked(notifyUser).mockClear();
        clearHandlerRegistry();
        registerHandlerMap(getArrangementHandlers());
        crustStore.set({});
        trackStore.set({ ...defaultTrackState, tracks: tracksWithTwoCrustDevices() });
    });

    it('writes named tiers to the addressed project devices and restores after session loss', async () => {
        await setCrustPanelUiLevel('a', 5);
        await setCrustPanelUiLevel('b', 2);

        expect(projectState('a')).toEqual({ version: 1, data: { unrelated: 'preserve', disclosureTier: 'lab' } });
        expect(projectState('b')).toEqual({ version: 1, data: { disclosureTier: 'shape' } });
        expect(getCrustState('a').patch.uiLevel).toBe(1);

        const projected = sanitizeTrackSnapshot(trackStore.value);
        trackStore.set({ ...defaultTrackState, tracks: projected.tracks });
        crustStore.set({});
        hydrateCrustPatchFromProject('a');
        hydrateCrustPatchFromProject('b');
        expect(getCrustState('a').patch.uiLevel).toBe(5);
        expect(getCrustState('b').patch.uiLevel).toBe(2);
    });

    it('refuses an unknown state version without replacing or disclosing a choice', async () => {
        const tracks = tracksWithTwoCrustDevices();
        const device = tracks[0]?.devices[0];
        if (!device) {
            throw new Error('Missing fixture device');
        }
        device.deviceState = { version: 99, data: { disclosureTier: 'lab', future: 'value' } };
        trackStore.set({ ...defaultTrackState, tracks });

        await setCrustPanelUiLevel('a', 4);
        expect(projectState('a')).toEqual({ version: 99, data: { disclosureTier: 'lab', future: 'value' } });
        expect(notifyUser).toHaveBeenCalledWith(expect.stringContaining('newer version'), 'warning');
        hydrateCrustPatchFromProject('a');
        expect(getCrustState('a').patch.uiLevel).toBe(1);
    });

    it('does not create state for a missing device', async () => {
        await setCrustPanelUiLevel('missing', 5);
        expect(projectState('a')).toEqual({ version: 1, data: { unrelated: 'preserve' } });
    });

    it('leaves project and visible tier unchanged when the command admission refuses', async () => {
        admission.reason = 'Project repair is required';
        await setCrustPanelUiLevel('a', 5);

        expect(projectState('a')).toEqual({ version: 1, data: { unrelated: 'preserve' } });
        expect(getCrustState('a').patch.uiLevel).toBe(1);
        expect(notifyUser).toHaveBeenCalledWith('Project repair is required', 'warning');
    });
});
