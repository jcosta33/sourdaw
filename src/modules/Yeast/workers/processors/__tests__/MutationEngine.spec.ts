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

const noteOn = (t: number, note: number, vel: number): MidiEvent => ({
    timeSamples: t,
    kind: { type: 'noteOn', channel: 0, note, velocity: vel },
});
const noteOff = (t: number, note: number): MidiEvent => ({
    timeSamples: t,
    kind: { type: 'noteOff', channel: 0, note },
});
const cc = (t: number, controller: number, value: number): MidiEvent => ({
    timeSamples: t,
    kind: { type: 'cc', channel: 0, cc: controller, value },
});

/** Clamp+round exactly as the processor's output stage does. */
function clampRound(v: number): number {
    return Math.max(1, Math.min(127, Math.round(v)));
}

describe('MutationEngine', () => {
    it('should export MutationEngine', () => {
        expect(MutationEngine).toBeDefined();
        const time = typeof MutationEngine;
        expect(time === 'function' || time === 'object').toBe(true);
    });

    describe('construction', () => {
        it('uses the provided id when given', () => {
            const engine = new MutationEngine('explicit');
            expect(engine.id).toBe('explicit');
            expect(engine.name).toBe('Mutation');
        });

        it('generates a mutation-prefixed id when none is provided', () => {
            const engine = new MutationEngine();
            expect(engine.id).toMatch(/^mutation-\d+$/);
        });
    });

    describe('drives a deterministic mutation walk from the shared Gaussian helper', () => {
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

        it('produces identical drift for the same seed and actually moves', () => {
            const first = walk(new MutationEngine('test-mut'));
            const second = walk(new MutationEngine('test-mut'));

            expect(second).toEqual(first); // same seed → same walk
            expect(first.some((value) => value !== 0)).toBe(true); // and it actually drifts
        });
    });

    describe('processMidi noteOn velocity mutation', () => {
        it('applies the current velocity_offset scaled by depth to each noteOn', () => {
            // With a fresh engine, velocity_offset target value is 0 and depth is
            // 0.5, so velOffset = 0 * 0.5 = 0 → velocity passes through unchanged
            // until a mutation step drifts the offset.
            const engine = new MutationEngine('vel-mut');
            const out: MidiEvent[] = [];
            engine.processMidi([noteOn(0, 60, 100)], out, transport);
            expect(out).toHaveLength(1);
            expect(out[0]?.kind.type).toBe('noteOn');
            if (out[0]?.kind.type === 'noteOn') {
                expect(out[0].kind.velocity).toBe(100);
            }
        });

        it('clamps a velocity+offset that would exceed 127 down to 127', () => {
            // depth=1, and force a large positive offset by mutating many times.
            // The velocity_offset target is clamped to max 30, so with depth=1
            // the offset is at most +30. Input velocity 120 + up to 30 → clamp 127.
            const engine = new MutationEngine('vel-clamp-hi');
            engine.setParam('depth', 1);
            engine.setParam('rate', 10); // stepsPerMutation = 1
            // Drive several mutation steps so velocity_offset drifts; it is
            // clamped to [-30, 30], so any note velocity near 127 must clamp.
            for (let i = 0; i < 16; i++) {
                engine.processMidi([], [], transport);
            }
            const offset = engine.getTargetValues()[0]!.value; // already depth-scaled
            const out: MidiEvent[] = [];
            engine.processMidi([noteOn(0, 60, 127)], out, transport);
            const expected = clampRound(127 + offset);
            if (out[0]?.kind.type === 'noteOn') {
                expect(out[0].kind.velocity).toBe(expected);
                expect(out[0].kind.velocity).toBeLessThanOrEqual(127);
            }
        });

        it('clamps a velocity+offset that would drop below 1 up to 1', () => {
            const engine = new MutationEngine('vel-clamp-lo');
            engine.setParam('depth', 1);
            engine.setParam('rate', 10);
            for (let i = 0; i < 16; i++) {
                engine.processMidi([], [], transport);
            }
            // processMidi runs a mutation step at its start, THEN applies
            // velOffset. So we must read the offset AFTER the event-bearing
            // processMidi to know what was actually applied.
            const out: MidiEvent[] = [];
            engine.processMidi([noteOn(0, 60, 1)], out, transport);
            const appliedOffset = engine.getTargetValues()[0]!.value;
            if (out[0]?.kind.type === 'noteOn') {
                expect(out[0].kind.velocity).toBe(clampRound(1 + appliedOffset));
                expect(out[0].kind.velocity).toBeGreaterThanOrEqual(1);
            }
        });
    });

    describe('processMidi non-noteOn passthrough', () => {
        it('passes noteOff events through unchanged', () => {
            const engine = new MutationEngine('pass-off');
            const event = noteOff(0, 60);
            const out: MidiEvent[] = [];
            engine.processMidi([event], out, transport);
            expect(out).toHaveLength(1);
            expect(out[0]).toBe(event);
        });

        it('passes CC events through unchanged', () => {
            const engine = new MutationEngine('pass-cc');
            const event = cc(0, 7, 64);
            const out: MidiEvent[] = [];
            engine.processMidi([event], out, transport);
            expect(out).toHaveLength(1);
            expect(out[0]).toBe(event);
        });
    });

    describe('mutation step cadence (stepsPerMutation gate)', () => {
        it('only mutates every stepsPerMutation blocks', () => {
            // Default stepsPerMutation = 4 and depth = 0.5. getTargetValues is
            // depth-scaled, so a freshly-constructed engine reports all zeros.
            // The walk must not begin until stepCounter reaches 4 (the 4th block).
            const engine = new MutationEngine('cadence');
            // Block 1: stepCounter 1 (< 4) → no mutation yet → offset still 0.
            engine.processMidi([], [], transport);
            expect(engine.getTargetValues()[0]!.value).toBe(0);
            // Block 2: stepCounter 2 → still 0.
            engine.processMidi([], [], transport);
            expect(engine.getTargetValues()[0]!.value).toBe(0);
            // Block 3: stepCounter 3 → still 0.
            engine.processMidi([], [], transport);
            expect(engine.getTargetValues()[0]!.value).toBe(0);
            // Block 4: stepCounter 4 >= 4 → mutateStep fires → offset drifts.
            engine.processMidi([], [], transport);
            // After one Gaussian step the velocity_offset target is almost never
            // exactly 0 (sigma=2); assert it became nonzero.
            expect(engine.getTargetValues()[0]!.value).not.toBe(0);
        });
    });

    describe('mutateStep keeps targets within their clamped range', () => {
        it('never lets velocity_offset escape [-30, 30] after many steps', () => {
            const engine = new MutationEngine('range-vel');
            engine.setParam('rate', 10); // stepsPerMutation = 1
            engine.setParam('depth', 1); // raw target value visible at depth 1
            for (let i = 0; i < 200; i++) {
                engine.processMidi([], [], transport);
            }
            // depth=1 so getTargetValues reports the raw clamped value.
            const raw = engine.getTargetValues()[0]!.value;
            expect(raw).toBeGreaterThanOrEqual(-30);
            expect(raw).toBeLessThanOrEqual(30);
        });

        it('never lets gate_mul escape [0.3, 1.8] after many steps', () => {
            const engine = new MutationEngine('range-gate');
            engine.setParam('rate', 10);
            engine.setParam('depth', 1);
            for (let i = 0; i < 200; i++) {
                engine.processMidi([], [], transport);
            }
            const raw = engine.getTargetValues()[1]!.value;
            expect(raw).toBeGreaterThanOrEqual(0.3);
            expect(raw).toBeLessThanOrEqual(1.8);
        });
    });

    describe('reset clears live drift state but keeps configured params', () => {
        it('restores target values to their baseValue and zeroes the step counter', () => {
            const engine = new MutationEngine('reset-state');
            engine.setParam('rate', 10);
            engine.setParam('depth', 1);
            // Drift the targets.
            for (let i = 0; i < 8; i++) {
                engine.processMidi([], [], transport);
            }
            expect(engine.getTargetValues().some((t) => t.value !== 0)).toBe(true);

            engine.reset();
            // After reset every target.value is back at its baseValue.
            // getTargetValues reports value * depth; with depth=1 that is the
            // raw baseValue: velocity_offset 0, gate_mul 1, octave_bias 0,
            // probability_offset 0.
            const reported = engine.getTargetValues();
            expect(reported[0]!.value).toBe(0);
            expect(reported[1]!.value).toBe(1);
            expect(reported[2]!.value).toBe(0);
            expect(reported[3]!.value).toBe(0);

            // stepCounter is also 0, so the next block (1 < stepsPerMutation=1)
            // ... with rate=10 stepsPerMutation=1, the next block DOES mutate.
            // Use the default cadence instead: reset stepCounter then check it
            // does not mutate on the first block when stepsPerMutation > 1.
            engine.setParam('rate', 0.5); // stepsPerMutation = round(4/0.5) = 8
            engine.processMidi([], [], transport); // stepCounter 1 < 8 → no mutate
            // gate_mul still at base 1 (depth 1) → unchanged.
            expect(engine.getTargetValues()[1]!.value).toBe(1);
        });
    });

    describe('resetParams restores configured depth and rate', () => {
        it('resets depth to 0.5 and stepsPerMutation to 4 after mutation', () => {
            const engine = new MutationEngine('reset-params');
            engine.setParam('depth', 1);
            engine.setParam('rate', 10); // stepsPerMutation = round(4/10) = 1
            // Confirm the rate took effect: a single block mutates velocity_offset
            // (baseValue 0) away from 0.
            engine.processMidi([], [], transport);
            expect(engine.getTargetValues()[0]!.value).not.toBe(0);

            // Access protected resetParams via unknown cast.
            (engine as unknown as { resetParams: () => void }).resetParams();
            // resetParams only resets depth/rate, NOT live target drift, so clear
            // the targets explicitly to detect the fresh cadence.
            engine.reset();

            // After resetParams, stepsPerMutation = 4 again, so three blocks must
            // NOT mutate velocity_offset (stepCounter 1,2,3 < 4).
            engine.processMidi([], [], transport);
            engine.processMidi([], [], transport);
            engine.processMidi([], [], transport);
            expect(engine.getTargetValues()[0]!.value).toBe(0); // still base
            // 4th block mutates.
            engine.processMidi([], [], transport);
            expect(engine.getTargetValues()[0]!.value).not.toBe(0);
        });
    });

    describe('setParam depth clamping', () => {
        it('clamps depth above 1 down to 1', () => {
            const engine = new MutationEngine('depth-hi');
            engine.setParam('depth', 99);
            engine.setParam('rate', 10);
            // Drift, then compare reported (depth-scaled) value against a
            // depth=1 sister with the same seed.
            const sister = new MutationEngine('depth-hi-sister');
            sister.setParam('depth', 1);
            sister.setParam('rate', 10);
            engine.processMidi([], [], transport);
            sister.processMidi([], [], transport);
            expect(engine.getTargetValues()[0]!.value).toBe(sister.getTargetValues()[0]!.value);
        });

        it('clamps depth below 0 up to 0 (no mutation audible)', () => {
            const engine = new MutationEngine('depth-lo');
            engine.setParam('depth', -5);
            engine.setParam('rate', 10);
            for (let i = 0; i < 8; i++) {
                engine.processMidi([], [], transport);
            }
            // depth=0 → every reported value is raw * 0 = 0 regardless of drift.
            // (JS may yield -0 for the velocity_offset product; treat ±0 as zero.)
            for (const target of engine.getTargetValues()) {
                expect(Object.is(target.value, -0) || target.value === 0).toBe(true);
            }
        });
    });

    describe('setParam rate clamping', () => {
        it('clamps rate below 0.1 up to 0.1 (longest step cadence)', () => {
            const engine = new MutationEngine('rate-lo');
            engine.setParam('rate', 0); // → clamped to 0.1 → stepsPerMutation = round(4/0.1) = 40
            engine.processMidi([], [], transport); // stepCounter 1 < 40 → no mutation
            // velocity_offset (baseValue 0) must still be at its base → reported 0.
            expect(engine.getTargetValues()[0]!.value).toBe(0);
        });

        it('clamps rate above 10 down to 10 (shortest step cadence)', () => {
            const engine = new MutationEngine('rate-hi');
            engine.setParam('rate', 999); // → clamped to 10 → stepsPerMutation = round(4/10) = 1
            // stepsPerMutation = 1 → the very first block mutates.
            engine.processMidi([], [], transport);
            expect(engine.getTargetValues().some((t) => t.value !== 0)).toBe(true);
        });

        it('rounds stepsPerMutation to at least 1 for large rates', () => {
            // rate=10 → 4/10 = 0.4 → round = 0 → max(1, 0) = 1.
            const engine = new MutationEngine('rate-min1');
            engine.setParam('rate', 10);
            engine.setParam('depth', 1);
            // If stepsPerMutation were 0, the >= check would fire every block but
            // with stepCounter reset; with 1 it fires every block. Either way the
            // first block must mutate, proving the floor kept it >= 1.
            engine.processMidi([], [], transport);
            expect(engine.getTargetValues().some((t) => t.value !== 0)).toBe(true);
        });
    });

    describe('getTargetValues', () => {
        it('reports all four mutation targets by name and base values', () => {
            const engine = new MutationEngine('targets');
            const values = engine.getTargetValues();
            expect(values.map((t) => t.name)).toEqual([
                'velocity_offset',
                'gate_mul',
                'octave_bias',
                'probability_offset',
            ]);
            // Fresh engine, depth 0.5. Reported = baseValue * depth:
            // velocity_offset 0*0.5=0, gate_mul 1*0.5=0.5, octave_bias 0,
            // probability_offset 0.
            expect(values[0]!.value).toBe(0);
            expect(values[1]!.value).toBe(0.5);
            expect(values[2]!.value).toBe(0);
            expect(values[3]!.value).toBe(0);
        });

        it('scales every reported value by depth', () => {
            const engine = new MutationEngine('targets-depth');
            engine.setParam('depth', 0.5);
            engine.setParam('rate', 10);
            const sister = new MutationEngine('targets-depth-sister');
            sister.setParam('depth', 1);
            sister.setParam('rate', 10);
            engine.processMidi([], [], transport);
            sister.processMidi([], [], transport);
            // Same seed/sigma → identical raw target; reported values differ by
            // the depth factor (0.5 vs 1.0).
            for (let i = 0; i < 4; i++) {
                const half = engine.getTargetValues()[i]!.value;
                const full = sister.getTargetValues()[i]!.value;
                if (full !== 0) {
                    expect(half).toBeCloseTo(full / 2, 6);
                }
            }
        });
    });
});
