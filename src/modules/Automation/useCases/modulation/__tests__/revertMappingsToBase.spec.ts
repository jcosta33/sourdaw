import { describe, it, expect, beforeEach, vi } from 'vitest';

type MockParamRange = {
    min: number;
    max: number;
    defaultValue: number;
    automatable: boolean;
};

type MockTrackStoreValue = {
    tracks: Array<{
        id: string;
        devices: Array<{
            id: string;
            type: string;
            parameterValues: Record<string, number>;
        }>;
    }>;
} | null;

type UpdateDeviceParam = (trackId: string, deviceId: string, paramId: string, value: number) => void;
type GetPluginParamRange = (deviceType: string, paramId: string) => MockParamRange | null;

const { mocks } = vi.hoisted(() => {
    const trackStore: { value: MockTrackStoreValue } = { value: null };
    return {
        mocks: {
            updateDeviceParam: vi.fn<UpdateDeviceParam>(),
            getPluginParamRange: vi.fn<GetPluginParamRange>(),
            trackStore,
        },
    };
});

vi.mock('#/modules/Arrangement/stores', () => ({
    trackStore: mocks.trackStore,
    resolveEligibleDeviceWriteTarget: (deviceId: string) => {
        const track = mocks.trackStore.value?.tracks.find((candidate) =>
            candidate.devices.some((device) => device.id === deviceId)
        );
        if (!track) {
            return { status: 'missing' };
        }
        return { status: 'eligible', trackId: track.id, deviceId };
    },
}));

type SubjectModules = {
    automationStore: typeof import('../../../stores/automationStore').automationStore;
    modulationStore: typeof import('../../../stores/modulationStore').modulationStore;
    setModulationDependencies: typeof import('../modulationDependencies').setModulationDependencies;
    applyModulationToEngine: typeof import('../applyModulationToEngine').applyModulationToEngine;
    resetModulationSlew: typeof import('../resetModulationSlew').resetModulationSlew;
    revertMappingsToBase: typeof import('../revertMappingsToBase').revertMappingsToBase;
};

async function loadSubjectModules(): Promise<SubjectModules> {
    vi.resetModules();
    const { automationStore } = await import('../../../stores/automationStore');
    const { modulationStore } = await import('../../../stores/modulationStore');
    const { setModulationDependencies } = await import('../modulationDependencies');
    const { applyModulationToEngine } = await import('../applyModulationToEngine');
    const { resetModulationSlew } = await import('../resetModulationSlew');
    const { revertMappingsToBase } = await import('../revertMappingsToBase');
    return {
        automationStore,
        modulationStore,
        setModulationDependencies,
        applyModulationToEngine,
        resetModulationSlew,
        revertMappingsToBase,
    };
}

function setTrackBase(baseValue: number): void {
    mocks.trackStore.value = {
        tracks: [
            {
                id: 't1',
                devices: [
                    {
                        id: 'd1',
                        type: 'builtin-filter',
                        parameterValues: { cutoff: baseValue },
                    },
                ],
            },
        ],
    };
}

function createMapping(amount: number) {
    return { targetTrackId: 't1', targetDeviceId: 'd1', targetParamId: 'cutoff', amount };
}

function setActiveModulator(modulationStore: SubjectModules['modulationStore'], amount: number): void {
    modulationStore.set({
        modulators: [
            {
                id: 'lfo1',
                name: 'LFO',
                trackId: 't1',
                kind: 'lfo',
                config: { kind: 'lfo', waveform: 'sine', rate: 4, sync: true, phase: 0, depth: 1 },
                mappings: [createMapping(amount)],
                enabled: true,
            },
        ],
    });
}

function setDependencies(setModulationDependencies: SubjectModules['setModulationDependencies']): void {
    setModulationDependencies({
        updateDeviceParam: mocks.updateDeviceParam,
        getPluginParamRange: mocks.getPluginParamRange,
        // `revertMappingsToBase` writes the persisted base back, which is a
        // restore rather than a slewed delivery and never reaches the quantiser;
        // identity keeps that visible instead of masking a call with rounding.
        quantiseValue: ({ value }) => value,
    });
}

describe('revertMappingsToBase', () => {
    beforeEach(() => {
        mocks.updateDeviceParam.mockReset();
        mocks.getPluginParamRange.mockReset();
        mocks.getPluginParamRange.mockReturnValue({ min: 0, max: 1000, defaultValue: 500, automatable: true });
        mocks.trackStore.value = null;
    });

    it('should silently no-op when modulation dependencies are not initialized', async () => {
        const { revertMappingsToBase } = await loadSubjectModules();
        setTrackBase(300);

        expect(() => revertMappingsToBase([createMapping(0.5)])).not.toThrow();
        expect(mocks.updateDeviceParam).not.toHaveBeenCalled();
    });

    it('should write each removed destination base value once', async () => {
        const { setModulationDependencies, revertMappingsToBase } = await loadSubjectModules();
        setDependencies(setModulationDependencies);
        setTrackBase(375);

        revertMappingsToBase([createMapping(0.5), createMapping(-0.25)]);

        expect(mocks.updateDeviceParam).toHaveBeenCalledTimes(1);
        expect(mocks.updateDeviceParam).toHaveBeenCalledWith('t1', 'd1', 'cutoff', 375);
    });

    it('should clear the same slew slot used by applyModulationToEngine', async () => {
        const {
            automationStore,
            modulationStore,
            setModulationDependencies,
            applyModulationToEngine,
            resetModulationSlew,
            revertMappingsToBase,
        } = await loadSubjectModules();
        setDependencies(setModulationDependencies);
        automationStore.set({ lanes: [] });
        resetModulationSlew();

        setTrackBase(500);
        setActiveModulator(modulationStore, 0.5);
        applyModulationToEngine(1);
        expect(mocks.updateDeviceParam).toHaveBeenCalledTimes(1);
        const [, , , initialValue] = mocks.updateDeviceParam.mock.calls[0]!;
        expect(initialValue).toBeCloseTo(1000);

        mocks.updateDeviceParam.mockClear();
        setTrackBase(200);
        revertMappingsToBase([createMapping(0.5)]);

        expect(mocks.updateDeviceParam).toHaveBeenCalledTimes(1);
        expect(mocks.updateDeviceParam).toHaveBeenLastCalledWith('t1', 'd1', 'cutoff', 200);

        mocks.updateDeviceParam.mockClear();
        setActiveModulator(modulationStore, 0);
        applyModulationToEngine(1);

        expect(mocks.updateDeviceParam).toHaveBeenCalledTimes(1);
        const [, , , postRevertValue] = mocks.updateDeviceParam.mock.calls[0]!;
        expect(postRevertValue).toBeCloseTo(200);
    });
});
