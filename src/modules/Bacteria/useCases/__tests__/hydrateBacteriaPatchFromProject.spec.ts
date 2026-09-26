import { describe, it, expect, beforeEach, vi } from 'vitest';

import { trackStore } from '#/modules/Arrangement/stores';

import { BACTERIA_MOD_ASSIGNMENTS_STATE_VERSION } from '../../models/BacteriaModAssignmentsState';
import { DEFAULT_PATCH, type BacteriaModAssignment, type BacteriaPatch } from '../../models/BacteriaPatch';
import {
    bacteriaStore,
    getBacteriaState,
    loadBacteriaPatch,
    setBacteriaParam,
    setBacteriaUiLevel,
} from '../../stores/bacteriaStore';
import { hydrateBacteriaPatchFromProject } from '../hydrateBacteriaPatchFromProject';

// The routing push (#4756) resolves its write target and its engine door
// through the shared bridge dependency object. Mocking only that object
// keeps `pushBacteriaModAssignmentsToEngine`'s own real `inject()` resolution
// intact — the same pattern would apply to any other bridge use case this
// hydrator started calling — so the assertions below observe the one door a
// projected routing table has to reach, `updateDevicePatch`, without a live
// engine node.
const mocks = vi.hoisted(() => ({
    resolveEligibleDeviceWriteTarget: vi.fn(),
    updateDevicePatch: vi.fn(),
}));

vi.mock('../bacteriaParamBridge/bacteriaParamBridgeDependencies', () => ({
    bacteriaParamBridgeDependencies: {
        resolveEligibleDeviceWriteTarget: mocks.resolveEligibleDeviceWriteTarget,
        updateDevicePatch: mocks.updateDevicePatch,
    },
}));

const DEVICE_ID = 'bacteria-1';
const TRACK_ID = 't1';

function row(overrides: Partial<BacteriaModAssignment> = {}): BacteriaModAssignment {
    return { sourceId: 'lfo1', targetParam: 'band0_drive', amount: 0.5, bipolar: true, ...overrides };
}

function seedProjectDevice(
    parameterValues: Record<string, number> | undefined,
    type = 'bacteria',
    deviceState?: unknown
): void {
    trackStore.set({
        tracks: [
            {
                id: 't1',
                devices: [{ id: DEVICE_ID, type, parameterValues, deviceState }],
            },
        ],
    } as unknown as typeof trackStore.value);
}

describe('hydrateBacteriaPatchFromProject', () => {
    beforeEach(() => {
        bacteriaStore.set({});
        trackStore.set(null);
        mocks.resolveEligibleDeviceWriteTarget.mockReset().mockReturnValue({ status: 'ineligible' });
        mocks.updateDevicePatch.mockReset();
    });

    it('loads nondefault persisted parameters into an empty device store (#3673)', () => {
        // The audit's scenario: project truth holds mix=0.25 while the store
        // still answers with the default 1.
        seedProjectDevice({ mix: 0.25, outputGain: -3.5 });

        hydrateBacteriaPatchFromProject(DEVICE_ID);

        const patch = getBacteriaState(DEVICE_ID).patch;
        expect(patch.mix).toBe(0.25);
        expect(patch.outputGain).toBe(-3.5);
        // Untouched fields keep the default.
        expect(patch.inputGain).toBe(DEFAULT_PATCH.inputGain);
    });

    it('decodes persisted per-band keys into the matching band slice', () => {
        seedProjectDevice({ band0_filterCutoff: 777, band1_drive: 60 });

        hydrateBacteriaPatchFromProject(DEVICE_ID);

        expect(getBacteriaState(DEVICE_ID).patch.bands[0]?.filterCutoff).toBe(777);
        expect(getBacteriaState(DEVICE_ID).patch.bands[1]?.drive).toBe(60);
        expect(getBacteriaState(DEVICE_ID).patch.bands[2]?.filterCutoff).toBe(DEFAULT_PATCH.bands[2]?.filterCutoff);
    });

    it('decodes the bridge’s boolean 0/1 and enum index encodings, not raw numbers', () => {
        // bypass persists as 1/0; globalRouting 'parallel' is index 1 in the
        // routing table the encoder writes with.
        seedProjectDevice({ bypass: 1, globalRouting: 1, band0_distortionMode: 3, band0_mute: 1 });

        hydrateBacteriaPatchFromProject(DEVICE_ID);

        const patch = getBacteriaState(DEVICE_ID).patch;
        expect(patch.bypass).toBe(true);
        expect(patch.globalRouting).toBe('parallel');
        expect(patch.bands[0]?.distortionMode).toBe('wavefold');
        expect(patch.bands[0]?.mute).toBe(true);
    });

    it('leaves a field alone when the stored enum index is outside its table', () => {
        seedProjectDevice({ globalRouting: 99 });

        hydrateBacteriaPatchFromProject(DEVICE_ID);

        expect(getBacteriaState(DEVICE_ID).patch.globalRouting).toBe(DEFAULT_PATCH.globalRouting);
    });

    it('follows a project change made without the panel setter', () => {
        // The inbound projection the bridge specs never covered: a command,
        // undo, or collaborator write updates project truth; the store must
        // follow on the next hydration without any panel setter call.
        seedProjectDevice({ mix: 0.25 });
        hydrateBacteriaPatchFromProject(DEVICE_ID);

        setBacteriaParam(DEVICE_ID, 'mix', 0.9);
        expect(getBacteriaState(DEVICE_ID).patch.mix).toBe(0.9);

        trackStore.set({
            tracks: [
                {
                    id: 't1',
                    devices: [{ id: DEVICE_ID, type: 'bacteria', parameterValues: { mix: 0.4 } }],
                },
            ],
        } as unknown as typeof trackStore.value);
        hydrateBacteriaPatchFromProject(DEVICE_ID);

        expect(getBacteriaState(DEVICE_ID).patch.mix).toBe(0.4);
    });

    it('ignores records for other devices and non-bacteria devices', () => {
        trackStore.set({
            tracks: [
                {
                    id: 't1',
                    devices: [
                        { id: 'other', type: 'bacteria', parameterValues: { mix: 0.1 } },
                        { id: DEVICE_ID, type: 'fermenter', parameterValues: { mix: 0.2 } },
                    ],
                },
            ],
        } as unknown as typeof trackStore.value);

        hydrateBacteriaPatchFromProject(DEVICE_ID);

        expect(getBacteriaState(DEVICE_ID).patch.mix).toBe(DEFAULT_PATCH.mix);
        // The other device's record is not this hydrator's business.
        expect(bacteriaStore.value?.other).toBeUndefined();
    });

    it('writes nothing when the record matches the current patch', () => {
        seedProjectDevice({ mix: DEFAULT_PATCH.mix });
        const before = bacteriaStore.value;

        hydrateBacteriaPatchFromProject(DEVICE_ID);

        // Referential stability of untouched instances keeps subscribers from
        // re-rendering on a no-op hydration.
        expect(bacteriaStore.value).toBe(before);
    });

    it('preserves patch metadata the engine never persists', () => {
        const metadataPatch: BacteriaPatch = {
            ...DEFAULT_PATCH,
            name: 'My patch',
            snapshots: [{ id: 'A', name: 'Corner', paramValues: { mix: 0.5 } }],
        };
        loadBacteriaPatch(DEVICE_ID, metadataPatch);
        seedProjectDevice({ mix: 0.25 });

        hydrateBacteriaPatchFromProject(DEVICE_ID);

        const patch: BacteriaPatch = getBacteriaState(DEVICE_ID).patch;
        expect(patch.name).toBe('My patch');
        expect(patch.snapshots).toEqual(metadataPatch.snapshots);
        expect(patch.mix).toBe(0.25);
    });

    it('projects the routing table from the deviceState chunk onto an empty store table (#4756)', () => {
        const r1 = row();
        setBacteriaUiLevel(DEVICE_ID, 1);
        expect(getBacteriaState(DEVICE_ID).patch.modAssignments).toEqual([]);
        seedProjectDevice(undefined, 'bacteria', {
            version: BACTERIA_MOD_ASSIGNMENTS_STATE_VERSION,
            data: { modAssignments: [r1] },
        });

        hydrateBacteriaPatchFromProject(DEVICE_ID);

        expect(getBacteriaState(DEVICE_ID).patch.modAssignments).toEqual([r1]);
    });

    it('projects the routing table even when parameterValues is absent', () => {
        const r1 = row();
        seedProjectDevice(undefined, 'bacteria', {
            version: BACTERIA_MOD_ASSIGNMENTS_STATE_VERSION,
            data: { modAssignments: [r1] },
        });

        hydrateBacteriaPatchFromProject(DEVICE_ID);

        expect(getBacteriaState(DEVICE_ID).patch.modAssignments).toEqual([r1]);
    });

    it('leaves the routing table untouched when the chunk is absent', () => {
        const r1 = row();
        loadBacteriaPatch(DEVICE_ID, { ...DEFAULT_PATCH, modAssignments: [r1] });
        seedProjectDevice({ mix: 0.5 });

        hydrateBacteriaPatchFromProject(DEVICE_ID);

        expect(getBacteriaState(DEVICE_ID).patch.modAssignments).toEqual([r1]);
    });

    it('pushes a projected routing table to the live engine for an eligible target (#4756)', () => {
        const rowA = row({ sourceId: 'macro1', targetParam: 'band1_filterCutoff', bipolar: false });
        const rowB = row({ sourceId: 'lfo1', targetParam: 'band0_drive' });
        loadBacteriaPatch(DEVICE_ID, { ...DEFAULT_PATCH, modAssignments: [rowA] });
        seedProjectDevice(undefined, 'bacteria', {
            version: BACTERIA_MOD_ASSIGNMENTS_STATE_VERSION,
            data: { modAssignments: [rowB] },
        });
        mocks.resolveEligibleDeviceWriteTarget.mockReturnValue({
            status: 'eligible',
            trackId: TRACK_ID,
            deviceId: DEVICE_ID,
        });

        hydrateBacteriaPatchFromProject(DEVICE_ID);

        expect(getBacteriaState(DEVICE_ID).patch.modAssignments).toEqual([rowB]);
        expect(mocks.updateDevicePatch).toHaveBeenCalledExactlyOnceWith(TRACK_ID, DEVICE_ID, {
            modAssignments: [{ sourceId: 0, targetParam: 16, amount: 50 }],
        });
    });

    it('does not push when the store table already equals the chunk', () => {
        const rowB = row();
        loadBacteriaPatch(DEVICE_ID, { ...DEFAULT_PATCH, modAssignments: [rowB] });
        seedProjectDevice(undefined, 'bacteria', {
            version: BACTERIA_MOD_ASSIGNMENTS_STATE_VERSION,
            data: { modAssignments: [rowB] },
        });
        mocks.resolveEligibleDeviceWriteTarget.mockReturnValue({
            status: 'eligible',
            trackId: TRACK_ID,
            deviceId: DEVICE_ID,
        });

        hydrateBacteriaPatchFromProject(DEVICE_ID);

        expect(mocks.updateDevicePatch).not.toHaveBeenCalled();
    });

    it('takes a projected table into the store but pushes nothing for an ineligible target', () => {
        const rowB = row();
        seedProjectDevice(undefined, 'bacteria', {
            version: BACTERIA_MOD_ASSIGNMENTS_STATE_VERSION,
            data: { modAssignments: [rowB] },
        });
        mocks.resolveEligibleDeviceWriteTarget.mockReturnValue({ status: 'ineligible' });

        hydrateBacteriaPatchFromProject(DEVICE_ID);

        expect(getBacteriaState(DEVICE_ID).patch.modAssignments).toEqual([rowB]);
        expect(mocks.updateDevicePatch).not.toHaveBeenCalled();
    });
});
