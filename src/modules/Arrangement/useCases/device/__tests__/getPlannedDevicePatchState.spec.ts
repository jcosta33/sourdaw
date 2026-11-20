import { describe, expect, it } from 'vitest';

import { type AppAction } from '#/utils/handlerContract';
import { DEVICE_TYPE_IDS } from '#/utils/nativeDspDeviceTypes';

import { plannedDeviceWriteStepByActionType } from '../getPlannedDevicePatchState';

describe('plannedDeviceWriteStepByActionType', () => {
    it('treats exactly these actions as other than a plain command step', () => {
        const plain = plannedDeviceWriteStepByActionType.selectTrack;
        const specialEntries = Object.entries(plannedDeviceWriteStepByActionType).filter(
            ([, entry]) => entry !== plain
        );
        const special = specialEntries.map(([type]) => type).sort();
        expect(special).toEqual(
            [
                'addTrack',
                'createBus',
                'setFermenterPatch',
                'setToasterFactoryKit',
                'setBacteriaFactoryPatch',
                'setLevainIdentity',
                'restoreTrack',
            ].sort()
        );
    });

    it('keeps an unrelated action as a command step and records no track id', () => {
        const trackIds = new Set<string>();
        const action = { type: 'selectTrack', payload: { trackId: 't' } } as const;
        expect(plannedDeviceWriteStepByActionType.selectTrack(action, trackIds)).toEqual({ kind: 'command', action });
        expect(trackIds.size).toBe(0);
    });

    it('records the id an added track or created bus brings and keeps the command step', () => {
        const trackIds = new Set<string>();
        const added = { type: 'addTrack', payload: { id: 'a', kind: 'audio' } } as const;
        const bus = { type: 'createBus', payload: { busId: 'b', name: 'Bus' } } as const;
        expect(plannedDeviceWriteStepByActionType.addTrack(added, trackIds)).toEqual({
            kind: 'command',
            action: added,
        });
        expect(plannedDeviceWriteStepByActionType.createBus(bus, trackIds)).toEqual({ kind: 'command', action: bus });
        expect([...trackIds].sort()).toEqual(['a', 'b']);
    });

    it('abandons the plan for a restored track whose snapshot does not own its id', () => {
        const trackIds = new Set<string>();
        const restore = {
            type: 'restoreTrack',
            payload: { trackId: 'a', trackSnapshot: { id: 'other' } },
        } as unknown as Parameters<typeof plannedDeviceWriteStepByActionType.restoreTrack>[0];
        expect(plannedDeviceWriteStepByActionType.restoreTrack(restore, trackIds)).toBeNull();
        expect(trackIds.size).toBe(0);
    });

    it('plans a restored track whose snapshot owns its id as a restore-owner step and records the id', () => {
        const trackIds = new Set<string>();
        const trackSnapshot = { id: 'a', devices: [] };
        const restore: Extract<AppAction, { type: 'restoreTrack' }> = {
            type: 'restoreTrack',
            payload: {
                trackId: 'a',
                trackSnapshot,
                trackName: 'A',
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
        expect(plannedDeviceWriteStepByActionType.restoreTrack(restore, trackIds)).toEqual({
            kind: 'restore-owner',
            source: { id: 'a', devices: [] },
        });
        expect([...trackIds]).toEqual(['a']);
    });

    it('plans a Fermenter patch as a patch step bound to its expected track and project states', () => {
        const trackIds = new Set<string>();
        const chunk = { version: 1, data: { patch: 'before' } };
        const action: Extract<AppAction, { type: 'setFermenterPatch' }> = {
            type: 'setFermenterPatch',
            payload: {
                deviceId: 'device-1',
                before: chunk,
                after: { version: 1, data: { patch: 'after' } },
                expectedCurrent: chunk,
                beforeProject: { deviceState: chunk, parameterValues: { mix: 0.1 } },
                afterProject: { deviceState: { version: 1, data: { patch: 'after' } }, parameterValues: { mix: 0.9 } },
                expectedProject: { deviceState: chunk, parameterValues: { mix: 0.1 } },
                expectedTrackId: 'track-7',
                expectedDeviceIds: ['device-1', 'device-2'],
                expectedTrackFrozen: true,
                label: 'Edit patch',
            },
        };
        expect(plannedDeviceWriteStepByActionType.setFermenterPatch(action, trackIds)).toEqual({
            kind: 'patch',
            trackId: 'track-7',
            deviceId: 'device-1',
            expectedDeviceIds: ['device-1', 'device-2'],
            expectedTrackFrozen: true,
            expected: { deviceState: chunk, parameterValues: { mix: 0.1 } },
            after: { deviceState: { version: 1, data: { patch: 'after' } }, parameterValues: { mix: 0.9 } },
        });
        expect(trackIds.size).toBe(0);
    });

    it('plans a Levain identity patch bound to its owner and captured state', () => {
        const trackIds = new Set<string>();
        const missingDeviceState = { version: 1, data: { instrumentId: 'violin-1' } };
        const before = { deviceState: null, parameterValues: { gain: null } };
        const after = { deviceState: { version: 1, data: { instrumentId: 'bank' } }, parameterValues: { gain: 0.4 } };
        const action = {
            type: 'setLevainIdentity',
            payload: {
                kind: 'instrument',
                trackId: 'track-7',
                deviceId: 'device-1',
                deviceIds: ['device-1', 'device-2'],
                label: 'Load instrument',
                missingDeviceState,
                before,
                after,
            },
        } satisfies AppAction;

        expect(plannedDeviceWriteStepByActionType.setLevainIdentity(action, trackIds)).toEqual({
            kind: 'patch',
            trackId: 'track-7',
            deviceId: 'device-1',
            expectedDeviceIds: ['device-1', 'device-2'],
            expectedTrackFrozen: false,
            expectedDeviceType: DEVICE_TYPE_IDS.levain,
            expected: before,
            after,
            preservedMetadata: {
                field: 'disclosureTier',
                allowedValues: ['basic', 'expert'],
                missingChunk: missingDeviceState,
            },
        });
        expect(trackIds.size).toBe(0);
    });
});
