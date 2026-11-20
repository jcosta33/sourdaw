import { describe, expect, it } from 'vitest';

import { type AppAction } from '#/utils/handlerContract';
import { DEVICE_TYPE_IDS } from '#/utils/nativeDspDeviceTypes';

import { projectDeviceChainAction } from '../DeviceChainActionProjection';
import { projectsDeviceChainByActionType } from '../ProjectsDeviceChainByActionType';
import { createTrack, type Device } from '../Track';

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
                'setLevainIdentity',
                'setToasterFactoryKit',
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

    it('projects a Fermenter patch while preserving unrelated device and parameter state', () => {
        const before = { version: 1, data: { patch: 'before' } };
        const after = { version: 1, data: { patch: 'after' } };
        const source: Device[] = [
            {
                id: 'fermenter',
                name: 'Fermenter',
                type: 'fermenter',
                bypassed: false,
                parameterValues: { mix: 0.2, untouched: 0.7 },
                deviceState: before,
            },
            { id: 'neighbor', name: 'Neighbor', type: 'other', bypassed: true, parameterValues: { gain: 0.4 } },
        ];
        const original = structuredClone(source);
        const action = {
            type: 'setFermenterPatch',
            payload: {
                deviceId: 'fermenter',
                before,
                after,
                expectedCurrent: before,
                beforeProject: { deviceState: before, parameterValues: { mix: 0.2 } },
                expectedProject: { deviceState: before, parameterValues: { mix: 0.2 } },
                afterProject: { deviceState: after, parameterValues: { mix: 0.8 } },
                expectedTrackId: 'track-1',
                expectedDeviceIds: ['fermenter', 'neighbor'],
                expectedTrackFrozen: false,
                label: 'Change patch',
            },
        } satisfies AppAction;

        expect(projectDeviceChainAction('track-1', source, action, [])).toEqual([
            { ...original[0], deviceState: after, parameterValues: { mix: 0.8, untouched: 0.7 } },
            original[1],
        ]);
        expect(source).toEqual(original);
    });

    it('projects Levain identity only for the captured owner, chain, and prior state', () => {
        const beforeChunk = { version: 1, data: { instrumentId: 'before' } };
        const afterChunk = { version: 1, data: { instrumentId: 'after' } };
        const levain: Device = {
            id: 'levain',
            name: 'Levain',
            type: DEVICE_TYPE_IDS.levain,
            bypassed: false,
            deviceState: beforeChunk,
            parameterValues: { removed: 0.2, untouched: 0.7 },
        };
        const neighbor: Device = {
            id: 'neighbor',
            name: 'Neighbor',
            type: 'other',
            bypassed: true,
            parameterValues: { gain: 0.4 },
        };
        const action = {
            type: 'setLevainIdentity',
            payload: {
                kind: 'instrument',
                trackId: 'track-1',
                deviceId: 'levain',
                deviceIds: ['levain', 'neighbor'],
                label: 'Load instrument',
                before: { deviceState: beforeChunk, parameterValues: { removed: 0.2, added: null } },
                after: { deviceState: afterChunk, parameterValues: { removed: null, added: 0.5 } },
            },
        } satisfies AppAction;
        const source = [levain, neighbor];
        const original = structuredClone(source);

        expect(projectDeviceChainAction('track-1', source, action, [])).toEqual([
            { ...levain, deviceState: afterChunk, parameterValues: { added: 0.5, untouched: 0.7 } },
            neighbor,
        ]);
        expect(projectDeviceChainAction('other-owner', source, action, [])).toBeNull();
        expect(source).toEqual(original);

        const staleChains: Device[][] = [
            [neighbor],
            [neighbor, levain],
            [{ ...levain, type: 'other' }, neighbor],
            [{ ...levain, deviceState: afterChunk }, neighbor],
            [{ ...levain, parameterValues: { ...levain.parameterValues, removed: 0.4 } }, neighbor],
            [{ ...levain, parameterValues: { ...levain.parameterValues, added: 0.5 } }, neighbor],
        ];
        for (const chain of staleChains) {
            const originalChain = structuredClone(chain);
            expect(projectDeviceChainAction('track-1', chain, action, [])).toBeNull();
            expect(chain).toEqual(originalChain);
        }
    });

    it('rejects a Toaster kit when the device type, chain order, or prior kit is stale', () => {
        const before = { version: 1, data: { kit: 'before' } };
        const after = { version: 1, data: { kit: 'after' } };
        const toaster: Device = {
            id: 'toaster',
            name: 'Toaster',
            type: DEVICE_TYPE_IDS.toaster,
            bypassed: false,
            parameterValues: { volume: 0.5 },
            deviceState: before,
        };
        const neighbor: Device = {
            id: 'neighbor',
            name: 'Neighbor',
            type: 'other',
            bypassed: false,
            parameterValues: { gain: 0.4 },
        };
        const action = {
            type: 'setToasterFactoryKit',
            payload: {
                trackId: 'track-1',
                deviceId: 'toaster',
                deviceIds: ['toaster', 'neighbor'],
                label: 'Load kit',
                before,
                after,
            },
        } satisfies AppAction;
        const cases: Device[][] = [
            [{ ...toaster, type: 'other' }, neighbor],
            [neighbor, toaster],
            [{ ...toaster, deviceState: { version: 1, data: { kit: 'different' } } }, neighbor],
        ];

        for (const source of cases) {
            const original = structuredClone(source);
            expect(projectDeviceChainAction('track-1', source, action, [])).toBeNull();
            expect(source).toEqual(original);
        }
    });
});
