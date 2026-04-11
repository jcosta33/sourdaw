import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { processYeastMidi } from '../yeastSchedulingBridge/processRealtimeMidiInput';

describe('processYeastMidi', () => {
    beforeEach(() => {
        Container.clear();
    });

    it('passes events through when the rack has no processors', () => {
        const events = [
            {
                timeSamples: 0,
                kind: { type: 'noteOn' as const, channel: 0, note: 60, velocity: 100 },
            },
        ];
        injectDependencies(processYeastMidi, {
            getYeastRack: vi.fn(() => ({
                getProcessorIds: () => [],
                processBlock: vi.fn(),
            })),
            transportStore: { value: { tempo: 120, isPlaying: true, timeSignatureNumerator: 4, timeSignatureDenominator: 4, loopStart: 0, loopEnd: 0 } },
            getAudioContext: vi.fn(() => (({
                sampleRate: 48000,
            }) as AudioContext)),
        });

        const out = processYeastMidi('t1', events, 0, 128);

        expect(out).toBe(events);
    });
});
