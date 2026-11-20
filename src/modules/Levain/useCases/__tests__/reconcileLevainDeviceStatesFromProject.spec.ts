import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type FixtureDevice = { id: string; type: string; deviceState: unknown; parameterValues: Record<string, number> };
type FixtureTracks = { tracks: { id: string; kind: string; devices: FixtureDevice[] }[] };

const mocks = vi.hoisted(() => ({
    trackStore: { value: undefined as FixtureTracks | undefined, subscribe: vi.fn(() => () => undefined) },
    applyPatchToEngine: vi.fn(),
    loadSamplesForInstrument: vi.fn(),
    setLevainParamWithAudio: vi.fn(),
}));

// Supply the projected owner fixture while keeping the other store contracts real.
vi.mock('#/modules/Arrangement/stores', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Arrangement/stores')>()),
    trackStore: mocks.trackStore,
}));
vi.mock('../levainParamBridge/applyPatchToEngine', () => ({ applyPatchToEngine: mocks.applyPatchToEngine }));
vi.mock('../levainParamBridge/loadSamplesForInstrument', () => ({
    loadSamplesForInstrument: mocks.loadSamplesForInstrument,
}));
vi.mock('../levainParamBridge/setLevainParamWithAudio', () => ({
    setLevainParamWithAudio: mocks.setLevainParamWithAudio,
}));
import { createDefaultPatch } from '../../models/LevainPatch';
import { defaultLevainState, levainStore } from '../../stores/levainStore';
import { reconcileLevainDeviceStatesFromProject } from '../reconcileLevainDeviceStatesFromProject';

const DEVICE_ID = 'levain-peer-1';
const TRACK_ID = 'track-1';

const VIOLIN_SUSTAIN_CHUNK = { version: 1, data: { instrumentId: 'violin-1', currentArticulation: 'sustain' } };
const CELLO_PIZZICATO_CHUNK = { version: 1, data: { instrumentId: 'cello', currentArticulation: 'pizzicato' } };

function projectWith(...devices: FixtureDevice[]): void {
    mocks.trackStore.value = { tracks: [{ id: TRACK_ID, kind: 'midi', devices }] };
}

function levainDevice(deviceState: unknown, parameterValues: Record<string, number> = {}): FixtureDevice {
    return { id: DEVICE_ID, type: 'levain', deviceState, parameterValues };
}

describe('reconcileLevainDeviceStatesFromProject', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.trackStore.value = undefined;
        levainStore.set({ [DEVICE_ID]: { ...defaultLevainState, patch: createDefaultPatch('violin-1') } });
    });

    afterEach(() => {
        levainStore.set({});
    });

    it('applies a peer-committed identity to the store and the engine doors', async () => {
        projectWith(levainDevice(CELLO_PIZZICATO_CHUNK));

        reconcileLevainDeviceStatesFromProject();

        expect(mocks.loadSamplesForInstrument).toHaveBeenCalledWith(DEVICE_ID, 'cello');
        expect(mocks.applyPatchToEngine).toHaveBeenCalledWith(
            DEVICE_ID,
            expect.objectContaining({ instrumentId: 'cello', currentArticulation: 'pizzicato' })
        );
        expect(mocks.setLevainParamWithAudio).not.toHaveBeenCalled();
        expect(levainStore.value?.[DEVICE_ID]?.patch.instrumentId).toBe('cello');
        expect(levainStore.value?.[DEVICE_ID]?.patch.currentArticulation).toBe('pizzicato');
    });

    it('reconciles the owner type only', async () => {
        projectWith(levainDevice(CELLO_PIZZICATO_CHUNK), {
            id: 'toaster-1',
            type: 'toaster',
            deviceState: undefined,
            parameterValues: {},
        });

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

    it('projects a saved Master and its removal on an instance without a device-state chunk', () => {
        projectWith(levainDevice(undefined, { masterGain: 0.34 }));
        reconcileLevainDeviceStatesFromProject();
        expect(levainStore.value?.[DEVICE_ID]?.patch.masterGain).toBe(0.34);

        projectWith(levainDevice(undefined, { master_gain: 0.56 }));
        reconcileLevainDeviceStatesFromProject();
        expect(levainStore.value?.[DEVICE_ID]?.patch.masterGain).toBe(0.56);

        projectWith(levainDevice(undefined));
        reconcileLevainDeviceStatesFromProject();
        expect(levainStore.value?.[DEVICE_ID]?.patch.masterGain).toBe(0.8);
        expect(mocks.applyPatchToEngine).not.toHaveBeenCalled();
        expect(mocks.setLevainParamWithAudio).not.toHaveBeenCalled();
    });

    it('does not re-apply when the chunk already matches the store identity', async () => {
        const storeBefore = levainStore.value?.[DEVICE_ID];
        projectWith(levainDevice(VIOLIN_SUSTAIN_CHUNK));

        reconcileLevainDeviceStatesFromProject();

        expect(levainStore.value?.[DEVICE_ID]).toBe(storeBefore);
        expect(mocks.loadSamplesForInstrument).not.toHaveBeenCalled();
        expect(mocks.applyPatchToEngine).not.toHaveBeenCalled();
        expect(mocks.setLevainParamWithAudio).not.toHaveBeenCalled();
    });

    it('projects the known instrument when the merged articulation belongs to another bank', () => {
        projectWith(levainDevice({ version: 1, data: { instrumentId: 'flute', currentArticulation: 'pizzicato' } }));

        reconcileLevainDeviceStatesFromProject();

        expect(mocks.loadSamplesForInstrument).toHaveBeenCalledWith(DEVICE_ID, 'flute');
        expect(levainStore.value?.[DEVICE_ID]?.patch).toMatchObject({
            instrumentId: 'flute',
            currentArticulation: 'sustain',
        });
    });
});

it('projects a peer-only tier without engine, sample or persistence writes', () => {
    vi.clearAllMocks();
    levainStore.set({
        [DEVICE_ID]: { ...defaultLevainState, patch: createDefaultPatch('violin-1') },
        sibling: structuredClone(defaultLevainState),
    });
    expect(levainStore.value?.sibling?.patch).not.toBe(levainStore.value?.[DEVICE_ID]?.patch);
    projectWith(
        levainDevice({ ...VIOLIN_SUSTAIN_CHUNK, data: { ...VIOLIN_SUSTAIN_CHUNK.data, disclosureTier: 'expert' } })
    );
    const patch = levainStore.value?.[DEVICE_ID]?.patch;
    reconcileLevainDeviceStatesFromProject();
    expect(levainStore.value?.[DEVICE_ID]?.uiLevel).toBe(6);
    expect(levainStore.value?.sibling?.uiLevel).toBe(1);
    expect(levainStore.value?.[DEVICE_ID]?.patch).toBe(patch);
    expect(mocks.applyPatchToEngine).not.toHaveBeenCalled();
    expect(mocks.loadSamplesForInstrument).not.toHaveBeenCalled();
    expect(mocks.setLevainParamWithAudio).not.toHaveBeenCalled();
});
