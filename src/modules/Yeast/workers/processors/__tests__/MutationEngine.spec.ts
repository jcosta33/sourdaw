import { describe, it, expect } from 'vitest';

import { type MidiEvent, type TransportInfo } from '../../../models/MidiEvent';
import { MutationEngine } from '../MutationEngine';

const transport: TransportInfo = {
    sampleRate: 44100,
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

describe('MutationEngine', () => {
    it('should export MutationEngine', () => {
        expect(MutationEngine).toBeDefined();
        const time = typeof MutationEngine;
        expect(time === 'function' || time === 'object').toBe(true);
    });

    it('drives a deterministic mutation walk from the shared Gaussian helper', () => {
        // Guards the gaussianLcg extraction: MutationEngine used to inline the
        // same Box-Muller transform with raw LCG steps. After folding it onto the
        // shared helper, the same seed must still drift the targets identically.
        function walk(engine: MutationEngine): number[] {
            engine.setParam('rate', 4); // stepsPerMutation = 1 → mutate every block
            const values: number[] = [];
            for (let index = 0; index < 8; index++) {
                const out: MidiEvent[] = [];
                engine.processMidi([], out, transport);
                values.push(engine.getTargetValues()[0]!.value);
            }
            return values;
        }

        const first = walk(new MutationEngine('test-mut'));
        const second = walk(new MutationEngine('test-mut'));

        expect(second).toEqual(first); // same seed → same walk
        expect(first.some((value) => value !== 0)).toBe(true); // and it actually drifts
    });
});
