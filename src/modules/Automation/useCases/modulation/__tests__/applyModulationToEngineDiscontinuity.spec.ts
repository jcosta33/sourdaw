import { describe, it, expect, beforeEach, vi } from 'vitest';

const { mocks } = vi.hoisted(() => ({
    mocks: {
        updateDeviceParam: vi.fn<(trackId: string, deviceId: string, paramId: string, value: number) => void>(),
        computeModulatorValue: vi.fn<() => number>(),
        resolveModulationBinding: vi.fn<() => { baseValue: number; paramMin: number; paramMax: number } | null>(),
    },
}));

vi.mock('#/modules/Arrangement/stores', () => ({
    trackStore: { value: null },
    resolveEligibleDeviceWriteTarget: (deviceId: string) => ({ status: 'eligible', trackId: 't1', deviceId }),
}));
vi.mock('../computeModulatorValue', () => ({ computeModulatorValue: mocks.computeModulatorValue }));
vi.mock('../resolveModulationBinding', () => ({ resolveModulationBinding: mocks.resolveModulationBinding }));

import { automationStore } from '../../../stores/automationStore';
import { modulationStore } from '../../../stores/modulationStore';
import { applyModulationToEngine } from '../applyModulationToEngine';
import { setModulationDependencies } from '../modulationDependencies';
import { resetModulationSlew } from '../resetModulationSlew';

describe('applyModulationToEngine transport discontinuity (AU-4 modulation)', () => {
    beforeEach(() => {
        resetModulationSlew();
        automationStore.set({ lanes: [] });
        mocks.updateDeviceParam.mockReset();
        // Fixed binding: base 500, range [0, 1000]. target = base + modValue * amount(0.5) * 1000.
        mocks.resolveModulationBinding.mockReturnValue({ baseValue: 500, paramMin: 0, paramMax: 1000 });
        setModulationDependencies({
            updateDeviceParam: mocks.updateDeviceParam,
            getPluginParamRange: () => null,
            // Identity: these cases assert the discontinuity snap on a device
            // that declares no contract at all, so the delivered value is the
            // filter value and the snap stays observable.
            quantiseValue: ({ value }) => value,
        });
        modulationStore.set({
            modulators: [
                {
                    id: 'lfo1',
                    name: 'LFO',
                    trackId: 't1',
                    kind: 'lfo',
                    config: { kind: 'lfo', waveform: 'sine', rate: 4, sync: true, phase: 0, depth: 1 },
                    mappings: [{ targetTrackId: 't1', targetDeviceId: 'd1', targetParamId: 'cutoff', amount: 0.5 }],
                    enabled: true,
                },
            ],
        });
    });

    it('snaps the modulated param to the new combined target on a discontinuity instead of gliding', () => {
        // Tick 1 at epoch 10: modValue 0 → target = 500. Seeds the slew slot.
        mocks.computeModulatorValue.mockReturnValue(0);
        applyModulationToEngine(1, 10);
        mocks.updateDeviceParam.mockReset();

        // Jump: epoch advances to 11 and modValue becomes 0.4 → target = 700.
        // Without a reset the write glides 500 + (700 - 500) * 0.4 = 580; the
        // fix must snap straight to 700.
        mocks.computeModulatorValue.mockReturnValue(0.4);
        applyModulationToEngine(2, 11);

        expect(mocks.updateDeviceParam).toHaveBeenCalledTimes(1);
        expect(mocks.updateDeviceParam).toHaveBeenCalledWith('t1', 'd1', 'cutoff', 700);
    });

    it('still slews normally within continuous playback when the epoch does not advance', () => {
        mocks.computeModulatorValue.mockReturnValue(0);
        applyModulationToEngine(1, 20);
        mocks.updateDeviceParam.mockReset();

        // Same epoch (20): the slew must ease toward the new target, not snap.
        mocks.computeModulatorValue.mockReturnValue(0.4);
        applyModulationToEngine(2, 20);

        expect(mocks.updateDeviceParam).toHaveBeenCalledTimes(1);
        const [, , , written] = mocks.updateDeviceParam.mock.calls[0]!;
        expect(written).toBeCloseTo(580, 5);
    });
});
