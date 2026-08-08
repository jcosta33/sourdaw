import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Unchecking "Enabled" on a modulator must hand the parameter back.
 *
 * `applyModulationToEngine` writes an override on every scheduler tick while a
 * mapping is live, and skips the modulator entirely once `enabled` is false.
 * Skipping the write does not undo the last one, so the engine keeps whatever
 * the LFO happened to be holding at the moment of the click — forever, and at
 * an arbitrary point of the waveform. `revertMappingsToBase` exists for exactly
 * this and its docblock names this failure, but until now only the *removal*
 * paths called it.
 *
 * The observable here is the engine seam (`updateDeviceParam`), which is the
 * value the DSP actually receives. The fixture separates the base (500) from
 * the modulated value the engine is holding (1000) by half the parameter range
 * so "reverted" cannot be confused with "the LFO happened to be at base".
 */

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
    updateModulator: typeof import('../updateModulator').updateModulator;
};

async function loadSubjectModules(): Promise<SubjectModules> {
    vi.resetModules();
    const { automationStore } = await import('../../../stores/automationStore');
    const { modulationStore } = await import('../../../stores/modulationStore');
    const { setModulationDependencies } = await import('../modulationDependencies');
    const { applyModulationToEngine } = await import('../applyModulationToEngine');
    const { resetModulationSlew } = await import('../resetModulationSlew');
    const { updateModulator } = await import('../updateModulator');
    return {
        automationStore,
        modulationStore,
        setModulationDependencies,
        applyModulationToEngine,
        resetModulationSlew,
        updateModulator,
    };
}

const BASE_VALUE = 500;

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

function setModulator(
    modulationStore: SubjectModules['modulationStore'],
    options: { amount: number; enabled: boolean; mappings?: ReturnType<typeof createMapping>[] }
): void {
    modulationStore.set({
        modulators: [
            {
                id: 'lfo1',
                name: 'LFO',
                trackId: 't1',
                kind: 'lfo',
                config: { kind: 'lfo', waveform: 'sine', rate: 4, sync: true, phase: 0, depth: 1 },
                mappings: options.mappings ?? [createMapping(options.amount)],
                enabled: options.enabled,
            },
        ],
    });
}

function setDependencies(setModulationDependencies: SubjectModules['setModulationDependencies']): void {
    setModulationDependencies({
        updateDeviceParam: mocks.updateDeviceParam,
        getPluginParamRange: mocks.getPluginParamRange,
        // Identity so the restore is observed as the exact base value rather
        // than a rounded neighbour of it.
        quantiseValue: ({ value }) => value,
    });
}

/**
 * Drive one modulation tick so the engine is holding a modulated override, and
 * prove it diverged from the base before anything is disabled. Without this the
 * revert assertion could be satisfied by an engine that was never moved.
 */
async function armEngineAwayFromBase(): Promise<SubjectModules> {
    const subject = await loadSubjectModules();
    setDependencies(subject.setModulationDependencies);
    subject.automationStore.set({ lanes: [] });
    subject.resetModulationSlew();
    setTrackBase(BASE_VALUE);
    setModulator(subject.modulationStore, { amount: 0.5, enabled: true });

    subject.applyModulationToEngine(1);

    expect(mocks.updateDeviceParam).toHaveBeenCalledTimes(1);
    const [, , , modulatedValue] = mocks.updateDeviceParam.mock.calls[0]!;
    expect(modulatedValue).toBeCloseTo(1000);
    expect(Math.abs(modulatedValue - BASE_VALUE)).toBeGreaterThan(400);
    mocks.updateDeviceParam.mockClear();
    return subject;
}

describe('disabling a modulator', () => {
    beforeEach(() => {
        mocks.updateDeviceParam.mockReset();
        mocks.getPluginParamRange.mockReset();
        mocks.getPluginParamRange.mockReturnValue({ min: 0, max: 1000, defaultValue: 500, automatable: true });
        mocks.trackStore.value = null;
    });

    it('hands the parameter back to its persisted base instead of freezing it at the last modulated value', async () => {
        const { updateModulator } = await armEngineAwayFromBase();

        updateModulator('lfo1', { enabled: false });

        expect(mocks.updateDeviceParam).toHaveBeenCalledTimes(1);
        expect(mocks.updateDeviceParam).toHaveBeenLastCalledWith('t1', 'd1', 'cutoff', BASE_VALUE);
    });

    it('leaves the parameter at the base across subsequent ticks, not back at the modulated value', async () => {
        const { updateModulator, applyModulationToEngine } = await armEngineAwayFromBase();

        updateModulator('lfo1', { enabled: false });
        mocks.updateDeviceParam.mockClear();

        // A disabled modulator is skipped, so the reverted base must survive the
        // next ticks. Asserting the revert call alone would not distinguish a
        // revert from a revert immediately overwritten again.
        applyModulationToEngine(2);
        applyModulationToEngine(3);

        expect(mocks.updateDeviceParam).not.toHaveBeenCalled();
    });

    it('reverts every distinct destination the modulator was driving', async () => {
        const subject = await loadSubjectModules();
        setDependencies(subject.setModulationDependencies);
        subject.automationStore.set({ lanes: [] });
        subject.resetModulationSlew();
        mocks.trackStore.value = {
            tracks: [
                {
                    id: 't1',
                    devices: [{ id: 'd1', type: 'builtin-filter', parameterValues: { cutoff: 500, resonance: 120 } }],
                },
            ],
        };
        setModulator(subject.modulationStore, {
            amount: 0.5,
            enabled: true,
            mappings: [createMapping(0.5), { ...createMapping(0.25), targetParamId: 'resonance' }],
        });

        subject.updateModulator('lfo1', { enabled: false });

        expect(mocks.updateDeviceParam.mock.calls).toEqual([
            ['t1', 'd1', 'cutoff', 500],
            ['t1', 'd1', 'resonance', 120],
        ]);
    });

    // --- negatives: the revert must be caused by the disable, not by any patch ---

    it('does not touch the engine when the patch only renames an enabled modulator', async () => {
        const { updateModulator, modulationStore } = await armEngineAwayFromBase();

        updateModulator('lfo1', { name: 'Wobble' });

        expect(mocks.updateDeviceParam).not.toHaveBeenCalled();
        expect(modulationStore.value?.modulators[0]?.name).toBe('Wobble');
    });

    it('does not revert when the patch enables a modulator', async () => {
        const subject = await loadSubjectModules();
        setDependencies(subject.setModulationDependencies);
        subject.automationStore.set({ lanes: [] });
        subject.resetModulationSlew();
        setTrackBase(BASE_VALUE);
        setModulator(subject.modulationStore, { amount: 0.5, enabled: false });

        subject.updateModulator('lfo1', { enabled: true });

        expect(mocks.updateDeviceParam).not.toHaveBeenCalled();
        expect(subject.modulationStore.value?.modulators[0]?.enabled).toBe(true);
    });

    it('does not revert when the modulator was already disabled', async () => {
        const subject = await loadSubjectModules();
        setDependencies(subject.setModulationDependencies);
        subject.automationStore.set({ lanes: [] });
        subject.resetModulationSlew();
        setTrackBase(BASE_VALUE);
        setModulator(subject.modulationStore, { amount: 0.5, enabled: false });

        subject.updateModulator('lfo1', { enabled: false });

        expect(mocks.updateDeviceParam).not.toHaveBeenCalled();
    });
});
