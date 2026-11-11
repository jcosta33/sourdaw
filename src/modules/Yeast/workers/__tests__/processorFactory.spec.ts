import { from, load, save } from '@automerge/automerge';
import { describe, it, expect } from 'vitest';

import { type MidiEvent, type TransportInfo } from '../../models/MidiEvent';
import { PROCESSOR_PARAM_DEFAULTS } from '../../models/ProcessorCatalog';
import * as subject from '../processorFactory';

describe('processorFactory', () => {
    it('should export createProcessor', () => {
        expect(subject.createProcessor).toBeDefined();
        const time = typeof subject.createProcessor;
        expect(time === 'function' || time === 'object').toBe(true);
    });

    it('keeps positive Arpeggiator MIDI output identical after materializing scalar defaults', () => {
        const transport: TransportInfo = {
            sampleRate: 48_000,
            bpm: 120,
            ppqPosition: 0,
            isPlaying: true,
            barIndex: 0,
            beatInBar: 0,
            timeSigNum: 4,
            timeSigDen: 4,
            loopEnabled: false,
            loopStartPpq: 0,
            loopEndPpq: 0,
        };
        const play = (initialParams: Record<string, number>) => {
            const processor = subject.createProcessor('arpeggiator', 'arp-parity');
            const output: MidiEvent[] = [];
            processor.replaceParams(initialParams);
            processor.processMidi(
                [
                    { timeSamples: 0, kind: { type: 'noteOn', channel: 0, note: 60, velocity: 90 } },
                    { timeSamples: 0, kind: { type: 'noteOn', channel: 0, note: 64, velocity: 110 } },
                ],
                output,
                { ...transport, blockStartSamples: 0, blockEndSamples: 128 }
            );
            processor.processMidi([], output, {
                ...transport,
                ppqPosition: 128 / 24_000,
                blockStartSamples: 128,
                blockEndSamples: 24_001,
            });
            processor.replaceParams({ ...initialParams, rate_denom: 14 });
            processor.processMidi([], output, {
                ...transport,
                ppqPosition: 24_001 / 24_000,
                blockStartSamples: 24_001,
                blockEndSamples: 70_001,
            });
            processor.processMidi(
                [
                    { timeSamples: 70_001, kind: { type: 'noteOff', channel: 0, note: 60 } },
                    { timeSamples: 70_001, kind: { type: 'noteOff', channel: 0, note: 64 } },
                ],
                output,
                { ...transport, ppqPosition: 70_001 / 24_000, blockStartSamples: 70_001, blockEndSamples: 90_001 }
            );
            return output;
        };

        const empty = play({});
        const binaryDefaults = load<{ params: Record<string, number> }>(
            save(from({ params: structuredClone(PROCESSOR_PARAM_DEFAULTS.arpeggiator) }))
        ).params;
        const materialized = play(binaryDefaults);
        const reversedOrder = play(Object.fromEntries(Object.entries(binaryDefaults).reverse()));

        expect(empty.filter((event) => event.kind.type === 'noteOn').map((event) => event.timeSamples)).toContain(
            12_000
        );
        expect(empty.filter((event) => event.kind.type === 'noteOn').map((event) => event.timeSamples)).toContain(
            24_000
        );
        expect(empty.some((event) => event.kind.type === 'noteOn' && event.timeSamples > 24_001)).toBe(true);
        expect(empty.some((event) => event.kind.type === 'noteOff')).toBe(true);
        expect(materialized).toEqual(empty);
        expect(reversedOrder).toEqual(empty);
    });
});
