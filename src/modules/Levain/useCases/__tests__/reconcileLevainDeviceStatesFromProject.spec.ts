import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type FixtureDevice = { id: string; type: string; deviceState: unknown };
type FixtureTracks = { tracks: { id: string; kind: string; devices: FixtureDevice[] }[] };

const mocks = vi.hoisted(() => ({
    trackStore: { value: undefined as FixtureTracks | undefined },
    resolveWriteTarget: vi.fn(),
    applyPatchToEngine: vi.fn(),
    loadSamplesForInstrument: vi.fn(),
    setLevainParamWithAudio: vi.fn(),
    executeAppAction: vi.fn((_action: unknown) => Promise.resolve()),
}));

// Exhaustive over this spec's graph: the sweep reads `trackStore`, the preset
// route its eligibility answer, and nothing else from this barrel.
vi.mock('#/modules/Arrangement/stores', () => ({
    trackStore: mocks.trackStore,
    resolveEligibleDeviceWriteTarget: mocks.resolveWriteTarget,
}));
// The engine doors a live identity change pushes through. `loadInstrument` and
// the reconciliation's own store writes stay real, so the session store carries
// exactly what a loaded session would hold.
vi.mock('../levainParamBridge/applyPatchToEngine', () => ({ applyPatchToEngine: mocks.applyPatchToEngine }));
vi.mock('../levainParamBridge/loadSamplesForInstrument', () => ({
    loadSamplesForInstrument: mocks.loadSamplesForInstrument,
}));
vi.mock('../levainParamBridge/setLevainParamWithAudio', () => ({
    setLevainParamWithAudio: mocks.setLevainParamWithAudio,
}));
// `loadPreset` reads this dependency record for its own eligibility gate; kept
// light so the real bridge (and its sample-loader graph) never loads.
vi.mock('../levainParamBridge/levainBridgeDependencies', () => ({
    levainBridgeDependencies: { resolveEligibleDeviceWriteTarget: mocks.resolveWriteTarget },
}));
// The persistence subscriber commits through this door; captured so the
// data-loss case can read exactly what a local edit mirrored into the document.
vi.mock('#/modules/Command/useCases', () => ({ executeAppAction: mocks.executeAppAction }));

import { createDefaultPatch } from '../../models/LevainPatch';
import { defaultLevainState, levainStore, setCurrentArticulation } from '../../stores/levainStore';
import { initLevainDeviceStatePersistence } from '../initLevainDeviceStatePersistence';
import { reconcileLevainDeviceStatesFromProject } from '../reconcileLevainDeviceStatesFromProject';

const DEVICE_ID = 'levain-peer-1';
const TRACK_ID = 'track-1';

const VIOLIN_SUSTAIN_CHUNK = { version: 1, data: { instrumentId: 'violin-1', currentArticulation: 'sustain' } };
const CELLO_PIZZICATO_CHUNK = { version: 1, data: { instrumentId: 'cello', currentArticulation: 'pizzicato' } };

function projectWith(...devices: FixtureDevice[]): void {
    mocks.trackStore.value = { tracks: [{ id: TRACK_ID, kind: 'midi', devices }] };
}

function levainDevice(deviceState: unknown): FixtureDevice {
    return { id: DEVICE_ID, type: 'levain', deviceState };
}

type SetDeviceStateAction = {
    type: 'setDeviceState';
    payload: { state: { data: { instrumentId: string; currentArticulation: string } } };
};

function isSetDeviceStateAction(value: unknown): value is SetDeviceStateAction {
    return typeof value === 'object' && value !== null && 'type' in value && value.type === 'setDeviceState';
}

describe('reconcileLevainDeviceStatesFromProject', () => {
    let stopPersistence: () => void;

    beforeEach(() => {
        vi.clearAllMocks();
        mocks.resolveWriteTarget.mockReturnValue({ status: 'eligible', trackId: TRACK_ID, deviceId: DEVICE_ID });
        mocks.trackStore.value = undefined;
        levainStore.set({ [DEVICE_ID]: { ...defaultLevainState, patch: createDefaultPatch('violin-1') } });
        // The persistence subscriber runs beside the sweep exactly as bootstrap
        // wires them: a reconciled identity is a store edit its committed map
        // has never seen, which is what the data-loss case reads back.
        stopPersistence = initLevainDeviceStatePersistence();
    });

    afterEach(() => {
        stopPersistence();
        levainStore.set({});
    });

    it('applies a peer-committed identity to the store and the engine doors', async () => {
        projectWith(levainDevice(CELLO_PIZZICATO_CHUNK));

        reconcileLevainDeviceStatesFromProject();

        // The instrument door (default patch, engine params, sample bank) and
        // the articulation door (store + runtime param) both fired.
        expect(mocks.loadSamplesForInstrument).toHaveBeenCalledWith(DEVICE_ID, 'cello');
        expect(mocks.applyPatchToEngine).toHaveBeenCalled();
        expect(mocks.setLevainParamWithAudio).toHaveBeenCalledWith(DEVICE_ID, 'currentArticulation', 'pizzicato');
        expect(levainStore.value?.[DEVICE_ID]?.patch.instrumentId).toBe('cello');
        expect(levainStore.value?.[DEVICE_ID]?.patch.currentArticulation).toBe('pizzicato');
    });

    it('reconciles the owner type only', async () => {
        projectWith(levainDevice(CELLO_PIZZICATO_CHUNK), { id: 'toaster-1', type: 'toaster', deviceState: undefined });

        reconcileLevainDeviceStatesFromProject();

        expect(levainStore.value?.[DEVICE_ID]?.patch.instrumentId).toBe('cello');
    });

    it('skips a device the session has not loaded', async () => {
        levainStore.set({});
        projectWith(levainDevice(CELLO_PIZZICATO_CHUNK));

        reconcileLevainDeviceStatesFromProject();

        expect(levainStore.value?.[DEVICE_ID]).toBeUndefined();
        expect(mocks.loadSamplesForInstrument).not.toHaveBeenCalled();
    });

    // The guard that makes the sweep affordable and loop-free: a change the
    // session's own persistence commit just wrote leaves the store untouched
    // and pushes nothing — the identity the document holds is the identity the
    // store already holds.
    it('does not re-apply when the chunk already matches the store identity', async () => {
        const storeBefore = levainStore.value?.[DEVICE_ID];
        projectWith(levainDevice(VIOLIN_SUSTAIN_CHUNK));

        reconcileLevainDeviceStatesFromProject();

        expect(levainStore.value?.[DEVICE_ID]).toBe(storeBefore);
        expect(mocks.loadSamplesForInstrument).not.toHaveBeenCalled();
        expect(mocks.applyPatchToEngine).not.toHaveBeenCalled();
        expect(mocks.setLevainParamWithAudio).not.toHaveBeenCalled();
    });

    // #4764's data-loss shape: the peer changes the instrument while the device
    // is loaded, then the user picks an articulation. The commit mirrors the
    // chunk's whole identity, so it carries the peer's instrument only if the
    // reconciliation applied it first — without that, this commit silently
    // overwrites the peer's cello with the stale violin.
    it('carries the peer key in the next local edit’s commit', async () => {
        projectWith(levainDevice(CELLO_PIZZICATO_CHUNK));

        reconcileLevainDeviceStatesFromProject();
        setCurrentArticulation(DEVICE_ID, 'spiccato');

        const commit = mocks.executeAppAction.mock.calls.map((call) => call[0]).findLast(isSetDeviceStateAction);
        expect(commit).toBeDefined();
        expect(commit?.payload.state.data.instrumentId).toBe('cello');
        expect(commit?.payload.state.data.currentArticulation).toBe('spiccato');
    });
});
