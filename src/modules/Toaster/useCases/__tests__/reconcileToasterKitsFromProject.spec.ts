import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type FixtureDevice = { id: string; type: string; deviceState: unknown };
type FixtureTracks = { tracks: { id: string; kind: string; devices: FixtureDevice[] }[] };

const mocks = vi.hoisted(() => ({
    trackStore: { value: undefined as FixtureTracks | undefined },
    resolveWriteTarget: vi.fn(),
    controls: { setParam: vi.fn(), setPadParam: vi.fn() },
    writeNative: vi.fn(),
    executeAppAction: vi.fn((_action: unknown) => Promise.resolve()),
}));

// Exhaustive over this spec's graph: the sweep reads `trackStore`, the preset
// route its eligibility answer, and nothing else from this barrel.
vi.mock('#/modules/Arrangement/stores', () => ({
    trackStore: mocks.trackStore,
    resolveEligibleDeviceWriteTarget: mocks.resolveWriteTarget,
}));
// The engine doors the live replacement route pushes through. Both mocked so the
// assertions observe the push without a strip or a native session.
vi.mock('../getToasterControls', () => ({ getToasterControls: () => mocks.controls }));
vi.mock('../writeToasterParamsNatively', () => ({ writeToasterParamsNatively: mocks.writeNative }));
// The persistence subscriber commits through this door; captured so the
// data-loss case can read exactly what a local edit mirrored into the document.
vi.mock('#/modules/Command/useCases', () => ({ executeAppAction: mocks.executeAppAction }));

import { createDefaultKit } from '../../models/ToasterKit';
import { toToasterKitState } from '../../models/ToasterKitState';
import { registerToasterDevice, toasterStore, updatePad } from '../../stores/toasterStore';
import { initToasterKitPersistence } from '../initToasterKitPersistence';
import { reconcileToasterKitsFromProject } from '../reconcileToasterKitsFromProject';

const DEVICE_ID = 'toaster-peer-1';
const TRACK_ID = 'track-1';

/** A peer's kit: identical to the default except pad 3 is renamed. */
function peerChunk(): ReturnType<typeof toToasterKitState> {
    const kit = createDefaultKit();
    kit.pads[3] = { ...kit.pads[3]!, name: 'Rimshot' };
    return toToasterKitState(kit);
}

function projectWith(...devices: FixtureDevice[]): void {
    mocks.trackStore.value = { tracks: [{ id: TRACK_ID, kind: 'midi', devices }] };
}

function toasterDevice(deviceState: unknown): FixtureDevice {
    return { id: DEVICE_ID, type: 'toaster', deviceState };
}

type SetDeviceStateAction = {
    type: 'setDeviceState';
    payload: { state: { data: { kit: { pads: Array<{ name?: string; muted?: boolean }> } } } };
};

function isSetDeviceStateAction(value: unknown): value is SetDeviceStateAction {
    return typeof value === 'object' && value !== null && 'type' in value && value.type === 'setDeviceState';
}

describe('reconcileToasterKitsFromProject', () => {
    let stopPersistence: () => void;

    beforeEach(() => {
        vi.clearAllMocks();
        mocks.resolveWriteTarget.mockReturnValue({ status: 'eligible', trackId: TRACK_ID, deviceId: DEVICE_ID });
        mocks.trackStore.value = undefined;
        toasterStore.set({});
        // The persistence subscriber runs beside the sweep exactly as bootstrap
        // wires them: a reconciled kit is a store edit its committed map has
        // never seen, which is what the data-loss case reads back.
        stopPersistence = initToasterKitPersistence();
        registerToasterDevice(DEVICE_ID);
    });

    afterEach(() => {
        stopPersistence();
        toasterStore.set({});
    });

    it('applies a peer-committed kit to the store and the ready engine', () => {
        projectWith(toasterDevice(peerChunk()));

        reconcileToasterKitsFromProject();

        expect(toasterStore.value?.[DEVICE_ID]?.kit.pads[3]?.name).toBe('Rimshot');
        // The live replacement route pushes both carriers: the worklet controls
        // and, additive on top, the native session.
        expect(mocks.controls.setPadParam).toHaveBeenCalled();
        expect(mocks.writeNative).toHaveBeenCalledTimes(1);
    });

    it('reconciles the owner type only', () => {
        projectWith(toasterDevice(peerChunk()), { id: 'levain-1', type: 'levain', deviceState: peerChunk() });

        reconcileToasterKitsFromProject();

        expect(toasterStore.value?.[DEVICE_ID]?.kit.pads[3]?.name).toBe('Rimshot');
        expect(mocks.writeNative).toHaveBeenCalledTimes(1);
    });

    it('skips a device the session has not loaded', () => {
        toasterStore.set({});
        projectWith(toasterDevice(peerChunk()));

        reconcileToasterKitsFromProject();

        expect(toasterStore.value?.[DEVICE_ID]).toBeUndefined();
        expect(mocks.writeNative).not.toHaveBeenCalled();
    });

    // The guard that makes the sweep affordable and loop-free: a change the
    // session's own persistence commit just wrote leaves the store object
    // untouched and pushes nothing — the kit the document holds is the kit the
    // store already holds.
    it('does not re-apply when the chunk already matches the store kit', () => {
        const kitBefore = toasterStore.value?.[DEVICE_ID]?.kit;
        if (!kitBefore) {
            throw new Error('store record must exist after registerToasterDevice');
        }
        projectWith(toasterDevice(toToasterKitState(kitBefore)));

        reconcileToasterKitsFromProject();

        expect(toasterStore.value?.[DEVICE_ID]?.kit).toBe(kitBefore);
        expect(mocks.controls.setParam).not.toHaveBeenCalled();
        expect(mocks.controls.setPadParam).not.toHaveBeenCalled();
        expect(mocks.writeNative).not.toHaveBeenCalled();
    });

    // #4764's data-loss shape: the peer's change lands while the device is
    // loaded, then the user edits an unrelated pad. The commit mirrors the whole
    // session store, so it carries the peer's key only if the reconciliation
    // applied it first — without that, this commit silently overwrites the
    // peer's pad name with the stale local one.
    it('carries the peer key in the next local edit’s commit', () => {
        projectWith(toasterDevice(peerChunk()));

        reconcileToasterKitsFromProject();
        updatePad(DEVICE_ID, 2, { muted: true });

        const commit = mocks.executeAppAction.mock.calls.map((call) => call[0]).findLast(isSetDeviceStateAction);
        if (!commit) {
            throw new Error('the local edit never committed a setDeviceState action');
        }
        const pads = commit.payload.state.data.kit.pads;
        expect(pads[3]?.name).toBe('Rimshot');
        expect(pads[2]?.muted).toBe(true);
    });
});
