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

/**
 * Drive `engine` across `beats` of transport time, rendered in blocks of
 * `blockSizeSamples` at `sampleRate`. Mirrors what MidiRack supplies: every
 * block carries its own half-open sample window.
 */
function runBeats(
    engine: MutationEngine,
    beats: number,
    { sampleRate = 44_100, blockSizeSamples = 128, bpm = 120 } = {}
): void {
    runSamples(engine, Math.round(((sampleRate * 60) / bpm) * beats), { sampleRate, blockSizeSamples, bpm });
}

/** Same, expressed as a raw sample span starting at 0. */
function runSamples(
    engine: MutationEngine,
    totalSamples: number,
    { sampleRate = 44_100, blockSizeSamples = 128, bpm = 120 } = {}
): void {
    for (let start = 0; start < totalSamples; start += blockSizeSamples) {
        const blockEndSamples = Math.min(start + blockSizeSamples, totalSamples);
        engine.processMidi([], [], {
            ...transport,
            sampleRate,
            bpm,
            blockStartSamples: start,
            blockEndSamples,
        });
    }
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
            engine.setParam('rate', 1); // one mutation per beat
            const values: number[] = [];
            for (let index = 0; index < 8; index++) {
                runBeats(engine, 1);
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
            engine.setParam('rate', 10); // ten mutations per beat
            // Drive several mutation steps so velocity_offset drifts; it is
            // clamped to [-30, 30], so any note velocity near 127 must clamp.
            runBeats(engine, 2);
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
            runBeats(engine, 2);
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

    describe('mutation cadence is musical, not per-block', () => {
        it('mutates once per beat at the default rate, not once every four blocks', () => {
            // `rate` means mutations per beat. Default rate 1 → the walk holds
            // still for just under a beat and steps exactly on it. A per-block
            // counter would have fired after 4 render quanta (512 samples at
            // 44.1 kHz — 2% of a beat at 120 bpm).
            const engine = new MutationEngine('cadence');
            engine.setParam('depth', 1);

            runBeats(engine, 0.9);
            expect(engine.getTargetValues()[0]!.value).toBe(0);

            runBeats(engine, 0.2); // crosses the first beat boundary
            expect(engine.getTargetValues()[0]!.value).not.toBe(0);
        });

        it('evolves identically at 44.1 kHz/128 and 96 kHz/512 over the same musical span', () => {
            // The decisive property: mutation cadence is a function of musical
            // time alone. Two engines fed the same 8 beats — one at 44.1 kHz in
            // 128-sample blocks (2756 blocks), one at 96 kHz in 512-sample
            // blocks (750 blocks) — must land on the same walk. Under the
            // per-block counter these differ by a factor of ~3.7.
            const standard = new MutationEngine('rate-standard');
            const highRate = new MutationEngine('rate-standard');
            for (const engine of [standard, highRate]) {
                engine.setParam('depth', 1);
                engine.setParam('rate', 2); // two mutations per beat
            }

            runBeats(standard, 8, { sampleRate: 44_100, blockSizeSamples: 128 });
            runBeats(highRate, 8, { sampleRate: 96_000, blockSizeSamples: 512 });

            expect(highRate.getTargetValues()).toEqual(standard.getTargetValues());
            // 8 beats × 2 per beat = 16 steps — the walk actually moved.
            expect(standard.getTargetValues()[0]!.value).not.toBe(0);
        });

        it('scales the number of steps with `rate`, at any block size', () => {
            // rate 4 over 2 beats and rate 2 over 4 beats are both 8 steps, so
            // the two walks land on the identical value from the same seed.
            const fast = new MutationEngine('rate-fast');
            const slow = new MutationEngine('rate-fast');
            fast.setParam('depth', 1);
            fast.setParam('rate', 4);
            slow.setParam('depth', 1);
            slow.setParam('rate', 2);

            runBeats(fast, 2, { blockSizeSamples: 64 });
            runBeats(slow, 4, { blockSizeSamples: 1024 });

            expect(slow.getTargetValues()).toEqual(fast.getTargetValues());
        });

        it('carries the sub-beat remainder across blocks instead of quantizing to block edges', () => {
            // 1000-sample blocks do not divide a 22050-sample beat. Over 6
            // beats the engine must still take exactly 6 steps — the same walk
            // a block size that divides evenly produces.
            const ragged = new MutationEngine('cadence-remainder');
            const even = new MutationEngine('cadence-remainder');
            ragged.setParam('depth', 1);
            even.setParam('depth', 1);

            runBeats(ragged, 6, { blockSizeSamples: 1000 });
            runBeats(even, 6, { blockSizeSamples: 2205 });

            expect(ragged.getTargetValues()).toEqual(even.getTargetValues());
        });
    });

    describe('catch-up bound', () => {
        // At 44.1 kHz / 120 bpm a beat is 22050 samples; rate 10 puts a
        // mutation every 2205. The catch-up loop is bounded at 64 steps.
        const SAMPLES_PER_MUTATION = 2205;
        const CAP = 64;

        function cappedEngine(id: string): MutationEngine {
            const engine = new MutationEngine(id);
            engine.setParam('rate', 10);
            engine.setParam('depth', 1);
            return engine;
        }

        it('keeps the sub-step remainder when the loop ends at exactly the cap', () => {
            // A block owing exactly 64 steps plus a 1000-sample remainder ends
            // the loop on its condition, not on the bound — the remainder is
            // legitimate and must carry. Discarding it whenever the step count
            // happens to equal the cap silently drops that fraction of a beat.
            const capped = cappedEngine('cap-exact');
            runSamples(capped, CAP * SAMPLES_PER_MUTATION + 1000, {
                blockSizeSamples: CAP * SAMPLES_PER_MUTATION + 1000,
            });
            runSamples(capped, SAMPLES_PER_MUTATION - 1000, { blockSizeSamples: SAMPLES_PER_MUTATION - 1000 });

            // The same total span in ordinary blocks owes 65 steps.
            const reference = cappedEngine('cap-exact');
            runSamples(reference, (CAP + 1) * SAMPLES_PER_MUTATION);

            expect(capped.getTargetValues()).toEqual(reference.getTargetValues());
        });

        it('drops the backlog when the bound actually cuts the loop short', () => {
            // A single block owing far more than 64 steps takes 64 and discards
            // the rest, rather than carrying a backlog that would keep the cap
            // firing on every later block.
            const overrun = cappedEngine('cap-overrun');
            runSamples(overrun, 200 * SAMPLES_PER_MUTATION, { blockSizeSamples: 200 * SAMPLES_PER_MUTATION });
            runSamples(overrun, SAMPLES_PER_MUTATION, { blockSizeSamples: SAMPLES_PER_MUTATION });

            // 64 capped steps + 1 = the same walk as 65 uncapped steps.
            const reference = cappedEngine('cap-overrun');
            runSamples(reference, (CAP + 1) * SAMPLES_PER_MUTATION);

            expect(overrun.getTargetValues()).toEqual(reference.getTargetValues());
        });
    });

    describe('mutateStep keeps targets within their clamped range', () => {
        it('never lets velocity_offset escape [-30, 30] after many steps', () => {
            const engine = new MutationEngine('range-vel');
            engine.setParam('rate', 10); // ten mutations per beat
            engine.setParam('depth', 1); // raw target value visible at depth 1
            runBeats(engine, 20); // 200 mutation steps
            // depth=1 so getTargetValues reports the raw clamped value.
            const raw = engine.getTargetValues()[0]!.value;
            expect(raw).toBeGreaterThanOrEqual(-30);
            expect(raw).toBeLessThanOrEqual(30);
        });

        it('never lets gate_mul escape [0.3, 1.8] after many steps', () => {
            const engine = new MutationEngine('range-gate');
            engine.setParam('rate', 10);
            engine.setParam('depth', 1);
            runBeats(engine, 20);
            const raw = engine.getTargetValues()[1]!.value;
            expect(raw).toBeGreaterThanOrEqual(0.3);
            expect(raw).toBeLessThanOrEqual(1.8);
        });
    });

    describe('reset clears live drift state but keeps configured params', () => {
        it('restores target values to their baseValue and zeroes the mutation phase', () => {
            const engine = new MutationEngine('reset-state');
            engine.setParam('rate', 10);
            engine.setParam('depth', 1);
            // Drift the targets.
            runBeats(engine, 1);
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

            // The mutation phase is zeroed too: at one mutation per two beats,
            // a full beat of transport after the reset still must not step.
            engine.setParam('rate', 0.5);
            runBeats(engine, 1);
            // gate_mul still at base 1 (depth 1) → unchanged.
            expect(engine.getTargetValues()[1]!.value).toBe(1);
        });
    });

    describe('resetParams restores configured depth and rate', () => {
        it('resets depth to 0.5 and rate to one mutation per beat', () => {
            const engine = new MutationEngine('reset-params');
            engine.setParam('depth', 1);
            engine.setParam('rate', 10); // ten mutations per beat
            // Confirm the rate took effect: a tenth of a beat drifts the walk.
            runBeats(engine, 0.15);
            expect(engine.getTargetValues()[0]!.value).not.toBe(0);

            // Access protected resetParams via unknown cast.
            (engine as unknown as { resetParams: () => void }).resetParams();
            // resetParams only resets depth/rate, NOT live target drift, so clear
            // the targets explicitly to detect the fresh cadence.
            engine.reset();
            // depth is back at 0.5, so the untouched gate_mul base of 1 reports 0.5.
            expect(engine.getTargetValues()[1]!.value).toBe(0.5);
            engine.setParam('depth', 1);

            // Back at one mutation per beat: 0.9 beats must not step.
            runBeats(engine, 0.9);
            expect(engine.getTargetValues()[0]!.value).toBe(0); // still base
            runBeats(engine, 0.2); // crosses the beat
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
            runBeats(engine, 1);
            runBeats(sister, 1);
            expect(engine.getTargetValues()[0]!.value).toBe(sister.getTargetValues()[0]!.value);
        });

        it('clamps depth below 0 up to 0 (no mutation audible)', () => {
            const engine = new MutationEngine('depth-lo');
            engine.setParam('depth', -5);
            engine.setParam('rate', 10);
            runBeats(engine, 1);
            // depth=0 → every reported value is raw * 0 = 0 regardless of drift.
            // (JS may yield -0 for the velocity_offset product; treat ±0 as zero.)
            for (const target of engine.getTargetValues()) {
                expect(Object.is(target.value, -0) || target.value === 0).toBe(true);
            }
        });
    });

    describe('setParam rate clamping', () => {
        it('clamps rate below 0.1 up to 0.1 (one mutation per ten beats)', () => {
            const engine = new MutationEngine('rate-lo');
            engine.setParam('rate', 0); // → clamped to 0.1
            runBeats(engine, 9); // still short of the first step
            // velocity_offset (baseValue 0) must still be at its base → reported 0.
            expect(engine.getTargetValues()[0]!.value).toBe(0);
            runBeats(engine, 2); // crosses beat 10
            expect(engine.getTargetValues()[0]!.value).not.toBe(0);
        });

        it('clamps rate above 10 down to 10 (ten mutations per beat)', () => {
            const engine = new MutationEngine('rate-hi');
            const ceiling = new MutationEngine('rate-hi');
            engine.setParam('rate', 999); // → clamped to 10
            ceiling.setParam('rate', 10);
            runBeats(engine, 4);
            runBeats(ceiling, 4);
            expect(engine.getTargetValues()).toEqual(ceiling.getTargetValues());
            expect(engine.getTargetValues().some((t) => t.value !== 0)).toBe(true);
        });

        it('does not step twice inside one beat-crossing block at the rate ceiling', () => {
            // A single block spanning a whole beat at rate 10 owes exactly 10
            // steps, not one and not a spin. Compare against the same span
            // rendered in ordinary 128-sample blocks.
            const oneBigBlock = new MutationEngine('rate-catchup');
            const manySmall = new MutationEngine('rate-catchup');
            oneBigBlock.setParam('rate', 10);
            oneBigBlock.setParam('depth', 1);
            manySmall.setParam('rate', 10);
            manySmall.setParam('depth', 1);

            runBeats(oneBigBlock, 1, { blockSizeSamples: 22_050 });
            runBeats(manySmall, 1, { blockSizeSamples: 128 });

            expect(oneBigBlock.getTargetValues()).toEqual(manySmall.getTargetValues());
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
            runBeats(engine, 1);
            runBeats(sister, 1);
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
