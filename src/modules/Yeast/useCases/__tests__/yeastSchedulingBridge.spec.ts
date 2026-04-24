import { describe, it, expect, vi, beforeEach } from 'vitest';

import { processYeastMidi } from '../yeastSchedulingBridge/processRealtimeMidiInput';

const mocks = vi.hoisted(() => ({
    getYeastRack: vi.fn(),
    transportStore: {
        value: null as {
            tempo: number;
            isPlaying: boolean;
            timeSignatureNumerator: number;
            timeSignatureDenominator: number;
            loopStart: number;
            loopEnd: number;
        } | null,
    },
    getAudioContext: vi.fn(),
}));

vi.mock('../../stores/yeastStore', () => ({
    getYeastRack: mocks.getYeastRack,
}));

vi.mock('#/modules/Transport/stores', () => ({
    transportStore: mocks.transportStore,
}));

vi.mock('#/modules/AudioEngine/useCases', () => ({
    getAudioContext: mocks.getAudioContext,
}));

describe('processYeastMidi', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('passes events through when the rack has no processors', () => {
        const events = [
            {
                timeSamples: 0,
                kind: { type: 'noteOn' as const, channel: 0, note: 60, velocity: 100 },
            },
        ];

        mocks.getYeastRack.mockReturnValue({
            getProcessorIds: () => [],
            processBlock: vi.fn(),
        });
        mocks.transportStore.value = {
            tempo: 120,
            isPlaying: true,
            timeSignatureNumerator: 4,
            timeSignatureDenominator: 4,
            loopStart: 0,
            loopEnd: 0,
        };
        mocks.getAudioContext.mockReturnValue({
            sampleRate: 48000,
        });

        const out = processYeastMidi(events, 0, 128);

        expect(out).toBe(events);
    });
});
