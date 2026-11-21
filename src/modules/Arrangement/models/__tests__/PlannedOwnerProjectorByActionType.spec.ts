import { describe, expect, it } from 'vitest';

import { type AppAction } from '#/utils/handlerContract';

import { projectCommandOwners } from '../PlannedOwnerProjectorByActionType';
import { type Device } from '../Track';

const chunk = { version: 1, data: { k: 1 } };
const patchState = { deviceState: chunk, parameterValues: {} };
const device: Device = { id: 'd', name: 'D', type: 'fermenter', bypassed: false, parameterValues: { mix: 0.2 } };
const sibling: Device = { id: 'e', name: 'E', type: 'other', bypassed: false, parameterValues: {} };

function owners() {
    return [{ id: 't', frozen: false, devices: [structuredClone(device), structuredClone(sibling)] }];
}

describe('plannedOwnerProjectorByActionType', () => {
    const captured: { type: AppAction['type']; action: AppAction }[] = [
        {
            type: 'setFermenterPatch',
            action: {
                type: 'setFermenterPatch',
                payload: {
                    deviceId: 'd',
                    before: chunk,
                    after: chunk,
                    expectedCurrent: chunk,
                    beforeProject: patchState,
                    afterProject: patchState,
                    expectedProject: patchState,
                    expectedTrackId: 't',
                    expectedDeviceIds: ['d', 'e'],
                    expectedTrackFrozen: false,
                    label: 'Patch',
                },
            },
        },
        {
            type: 'setToasterFactoryKit',
            action: {
                type: 'setToasterFactoryKit',
                payload: {
                    deviceId: 'd',
                    trackId: 't',
                    deviceIds: ['d', 'e'],
                    label: 'Kit',
                    before: null,
                    after: chunk,
                },
            },
        },
        {
            type: 'setBacteriaFactoryPatch',
            action: {
                type: 'setBacteriaFactoryPatch',
                payload: {
                    deviceId: 'd',
                    trackId: 't',
                    deviceIds: ['d', 'e'],
                    label: 'Patch',
                    before: { name: 'A', deviceState: null, parameterValues: {} },
                    after: { name: 'B', deviceState: null, parameterValues: {} },
                },
            },
        },
        {
            type: 'setGlutenFactoryPreset',
            action: {
                type: 'setGlutenFactoryPreset',
                payload: { deviceId: 'd', trackId: 't', deviceIds: ['d', 'e'], presetId: 'p', before: {}, after: {} },
            },
        },
        {
            type: 'setLevainIdentity',
            action: {
                type: 'setLevainIdentity',
                payload: {
                    kind: 'instrument',
                    deviceId: 'd',
                    trackId: 't',
                    deviceIds: ['d', 'e'],
                    label: 'Identity',
                    before: patchState,
                    after: patchState,
                    missingDeviceState: chunk,
                },
            },
        },
    ];

    it.each(captured)('$type is unsupported because no captured patch adapter exists', ({ action }) => {
        expect(projectCommandOwners(owners(), action, [])).toEqual({
            status: 'unsupported',
            reason: 'A current-format captured patch adapter is required',
        });
    });

    it('restoreTrack is unsupported because its snapshot is opaque', () => {
        const action: AppAction = {
            type: 'restoreTrack',
            payload: {
                trackId: 't',
                trackSnapshot: { id: 't' },
                trackName: 'T',
                trackKind: 'audio',
                trackGain: 1,
                trackParentId: null,
                trackIndex: 0,
                wasSelected: false,
                routingPatches: [],
                automationLaneSnapshots: [],
                clipSatellites: [],
                midiNotesByClipId: {},
                midiCcByClipId: {},
                midiPitchBendByClipId: {},
                takeLaneSnapshots: [],
                sidechainRouteSnapshots: [],
                ownedModulatorSnapshots: [],
                incomingModulationMappingSnapshots: [],
            },
        };
        expect(projectCommandOwners(owners(), action, [])).toMatchObject({
            status: 'unsupported',
            reason: 'The opaque track snapshot needs an owning planned-source adapter',
        });
    });

    it('removeTrack drops only the removed owner', () => {
        const both = [...owners(), { id: 'u', devices: [] }];
        expect(projectCommandOwners(both, { type: 'removeTrack', payload: { trackId: 't' } }, [])).toEqual({
            status: 'projected',
            owners: [{ id: 'u', devices: [] }],
        });
    });

    it('a type with no entry of its own projects through every owner chain', () => {
        const result = projectCommandOwners(owners(), { type: 'removeDevice', payload: { deviceId: 'd' } }, []);
        expect(result).toEqual({
            status: 'projected',
            owners: [{ id: 't', frozen: false, devices: [sibling] }],
        });
        expect(projectCommandOwners(owners(), { type: 'selectTrack', payload: { trackId: 't' } }, [])).toEqual({
            status: 'projected',
            owners: owners(),
        });
    });
});
