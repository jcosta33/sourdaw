import { describe, expect, it } from 'vitest';

import { getPluginById } from '../DeviceParameter';
import { type DevicePatchState } from '../DevicePatchState';
import {
    type CapturedDevicePatchStep,
    type PlannedDeviceOwnerSource,
    type PlannedDeviceWriteStep,
} from '../PlannedDeviceWrite';
import { planDevicePatchWrite } from '../planDevicePatchWrite';

const p: DevicePatchState = { deviceState: null, parameterValues: { filterCutoff: 600, filterModel: null } };
const m: DevicePatchState = {
    deviceState: { version: 1, data: { name: 'draft M', macros: [0.83], mappings: [{ depth: 0.47 }] } },
    parameterValues: { filterCutoff: 1234, filterModel: null },
};
const n: DevicePatchState = {
    deviceState: { version: 1, data: { name: 'N' } },
    parameterValues: { filterCutoff: 1800, filterModel: 2 },
};

function device(state: DevicePatchState) {
    const parameterValues: Record<string, number> = { unrelated: 7 };
    for (const [key, value] of Object.entries(state.parameterValues)) {
        if (value !== null) {
            parameterValues[key] = value;
        }
    }
    const base = { id: 'synth', type: 'fermenter', name: 'My alias', bypassed: false, parameterValues };
    return state.deviceState === null ? base : { ...base, deviceState: state.deviceState };
}

function owner(state: DevicePatchState): PlannedDeviceOwnerSource {
    return { id: 'owner', frozen: false, devices: [device(state)] };
}

function patch(expected: DevicePatchState, after: DevicePatchState): CapturedDevicePatchStep {
    return {
        kind: 'patch',
        trackId: 'owner',
        deviceId: 'synth',
        expectedDeviceIds: ['synth'],
        expectedTrackFrozen: false,
        expected,
        after,
    };
}

function parameter(expectedValue: number, value: number): PlannedDeviceWriteStep {
    return {
        kind: 'command',
        action: {
            type: 'setDeviceParameter',
            payload: {
                deviceId: 'synth',
                paramId: 'filterCutoff',
                value,
                expectedTrackId: 'owner',
                expectedDeviceType: 'fermenter',
                expectedDeviceIds: ['synth'],
                expectedValuePresent: true,
                expectedValue,
                expectedTrackFrozen: false,
            },
        },
    };
}

function plan(
    source: readonly PlannedDeviceOwnerSource[],
    steps: readonly PlannedDeviceWriteStep[],
    actionIndex: number
) {
    return planDevicePatchWrite({
        source,
        steps,
        actionIndex,
        trackId: 'owner',
        deviceId: 'synth',
        parameterIds: ['filterCutoff', 'filterModel'],
        plugins: [],
    });
}

describe('planDevicePatchWrite', () => {
    it('separates the initial raw source, prefix preflight and terminal clamped parameter state', () => {
        const source = owner(p);
        const before = structuredClone(source);
        const result = plan([source], [patch(p, n), parameter(1800, 25000)], 1);
        expect(result.status).toBe('ready');
        if (result.status !== 'ready') {
            throw new Error(result.reason);
        }
        expect(result.source).toMatchObject({ kind: 'device', state: p });
        expect(result.prefix).toMatchObject({ kind: 'device', state: n });
        expect(result.terminal).toMatchObject({
            kind: 'device',
            state: { ...n, parameterValues: { filterCutoff: 20000, filterModel: 2 } },
        });
        expect(source).toEqual(before);
    });

    it('composes the reverse parameter-then-patch group without requiring the raw source to equal its midpoint', () => {
        const q = { ...n, parameterValues: { filterCutoff: 20000, filterModel: 2 } };
        const result = plan([owner(q)], [parameter(20000, 1800), patch(n, p)], 1);
        expect(result.status).toBe('ready');
        if (result.status !== 'ready') {
            throw new Error(result.reason);
        }
        expect(result.source).toMatchObject({ kind: 'device', state: q });
        expect(result.prefix).toMatchObject({ kind: 'device', state: n });
        expect(result.terminal).toMatchObject({ kind: 'device', state: p });
    });

    it('uses raw P for admission and complete pending M for the later Undo target', () => {
        const forward = plan([owner(p)], [patch(p, n)], 0);
        const inverse = plan([owner(n)], [patch(n, m)], 0);
        expect(forward).toMatchObject({ status: 'ready', source: { state: p }, terminal: { state: n } });
        expect(inverse).toMatchObject({ status: 'ready', source: { state: n }, terminal: { state: m } });
        expect(plan([owner(p)], [patch(m, n)], 0).status).toBe('conflict');
    });

    it('validates every repeated patch midpoint rather than accepting a broken declared chain', () => {
        expect(plan([owner(p)], [patch(p, m), patch(m, n)], 1)).toMatchObject({
            status: 'ready',
            prefix: { state: m },
            terminal: { state: n },
        });
        expect(plan([owner(p)], [patch(p, m), patch(p, n)], 1).status).toBe('conflict');
    });

    it('plans absent-device restoration before a patch and terminal removal after a patch', () => {
        const restored = plan(
            [{ id: 'owner', frozen: false, devices: [] }],
            [
                {
                    kind: 'command',
                    action: {
                        type: 'restoreDevice',
                        payload: { trackId: 'owner', deviceIndex: 0, deviceSnapshot: device(n), expectedDeviceIds: [] },
                    },
                },
                patch(n, p),
            ],
            1
        );
        expect(restored).toMatchObject({
            status: 'ready',
            source: { kind: 'absent-device' },
            prefix: { state: n },
            terminal: { state: p },
        });
        const removed = plan(
            [owner(p)],
            [patch(p, n), { kind: 'command', action: { type: 'removeDevice', payload: { deviceId: 'synth' } } }],
            0
        );
        expect(removed).toMatchObject({ status: 'ready', source: { state: p }, terminal: { kind: 'absent-device' } });
    });

    it('accepts only an explicit owner restoration source and retains terminal track absence', () => {
        const restored = plan([], [{ kind: 'restore-owner', source: owner(n) }, patch(n, p)], 1);
        expect(restored).toMatchObject({
            status: 'ready',
            source: { kind: 'absent-track' },
            prefix: { state: n },
            terminal: { state: p },
        });
        expect(
            plan(
                [owner(p)],
                [patch(p, n), { kind: 'command', action: { type: 'removeTrack', payload: { trackId: 'owner' } } }],
                0
            )
        ).toMatchObject({ status: 'ready', terminal: { kind: 'absent-track' } });
    });

    it('rejects changed scalar presence, duplicate ownership and a stale parameter source', () => {
        expect(
            plan([owner({ ...p, parameterValues: { filterCutoff: 600, filterModel: 0 } })], [patch(p, n)], 0).status
        ).toBe('conflict');
        expect(plan([owner(p), { ...owner(p), id: 'other-owner' }], [patch(p, n)], 0).status).toBe('conflict');
        expect(plan([owner(n)], [parameter(1700, 2000)], 0).status).toBe('conflict');
    });

    it('reuses the device catalog, reorder and opaque state projection rules without mutating inputs', () => {
        const plugin = getPluginById('fermenter');
        if (!plugin) {
            throw new Error('Expected Fermenter descriptor');
        }
        if (!n.deviceState) {
            throw new Error('Expected the changed state chunk');
        }
        const source = owner(p);
        const result = planDevicePatchWrite({
            source: [source],
            trackId: 'owner',
            deviceId: 'synth',
            parameterIds: ['filterCutoff', 'filterModel'],
            actionIndex: 0,
            plugins: [plugin],
            steps: [
                {
                    kind: 'command',
                    action: {
                        type: 'addDevice',
                        payload: { trackId: 'owner', deviceType: 'fermenter', deviceId: 'added' },
                    },
                },
                {
                    kind: 'command',
                    action: {
                        type: 'reorderDevices',
                        payload: {
                            trackId: 'owner',
                            deviceId: 'synth',
                            targetIndex: 1,
                            expectedBefore: {
                                id: 'owner',
                                kind: 'midi',
                                devices: [
                                    {
                                        id: 'synth',
                                        type: 'fermenter',
                                        parameterIds: Object.keys(device(p).parameterValues).sort(),
                                    },
                                    {
                                        id: 'added',
                                        type: plugin.id,
                                        parameterIds: [
                                            ...new Set([
                                                ...Object.keys(plugin.internalParameterValues ?? {}),
                                                ...plugin.parameters.map((parameter) => parameter.id),
                                            ]),
                                        ].sort(),
                                    },
                                ],
                            },
                        },
                    },
                },
                {
                    kind: 'command',
                    action: { type: 'setDeviceState', payload: { deviceId: 'synth', state: n.deviceState } },
                },
            ],
        });
        expect(result).toMatchObject({
            status: 'ready',
            terminal: {
                deviceIds: ['added', 'synth'],
                state: { deviceState: n.deviceState, parameterValues: p.parameterValues },
            },
        });
        expect(source.devices).toHaveLength(1);
        expect(source.devices[0]).not.toHaveProperty('deviceState');
    });
});
