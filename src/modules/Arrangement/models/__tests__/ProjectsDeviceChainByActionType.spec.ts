import { describe, expect, it } from 'vitest';

import { projectDeviceChainAction } from '../DeviceChainActionProjection';
import { projectsDeviceChainByActionType } from '../ProjectsDeviceChainByActionType';
import { createTrack } from '../Track';

describe('projectsDeviceChainByActionType', () => {
    it('is true for exactly the device-chain actions', () => {
        const projectingEntries = Object.entries(projectsDeviceChainByActionType).filter(([, projects]) => projects);
        const projecting = projectingEntries.map(([type]) => type).sort();
        expect(projecting).toEqual(
            [
                'addDevice',
                'removeDevice',
                'reorderDevices',
                'restorePresetDeviceChain',
                'restoreDevice',
                'setDeviceParameter',
                'setDeviceState',
                'setFermenterPatch',
            ].sort()
        );
    });

    it('gates projectDeviceChainAction: a device action projects and an unlisted action returns null', () => {
        const track = createTrack({ id: 'track-1', kind: 'midi', name: 'Track' });
        const projected = projectDeviceChainAction(
            track.id,
            track.devices,
            { type: 'removeDevice', payload: { deviceId: 'missing' } },
            []
        );
        expect(projected).toEqual(track.devices);
        expect(
            projectDeviceChainAction(
                track.id,
                track.devices,
                { type: 'selectTrack', payload: { trackId: 'track-1' } },
                []
            )
        ).toBeNull();
    });
});
