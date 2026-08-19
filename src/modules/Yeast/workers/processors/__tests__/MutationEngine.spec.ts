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
                values.push(engine.__getTargetValuesForTest()[0]!.value);
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
            const offset = engine.__getTargetValuesForTest()[0]!.value; // already depth-scaled
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
            const appliedOffset = engine.__getTargetValuesForTest()[0]!.value;
            if (out[0]?.kind.type === 'noteOn') {
                expect(out[0].kind.velocity).toBe(clampRound(1 + appliedOffset));
                expect(out[0].kind.velocity).toBeGreaterThanOrEqual(1);
            }
        });
    });

    describe('processMidi non-noteOn passthrough', () => {
        it('passes an orphan noteOff through with its original note (no matching noteOn seen)', () => {
            // No prior noteOn means no passDecisions/pitchVoices entry for this
            // key — the engine must not drop or shift it (parity with
            // NoteFilter's undefined-decision passthrough).
            const engine = new MutationEngine('pass-off');
            const event = noteOff(0, 60);
            const out: MidiEvent[] = [];
            engine.processMidi([event], out, transport);
            expect(out).toHaveLength(1);
            expect(out[0]?.kind.type).toBe('noteOff');
            if (out[0]?.kind.type === 'noteOff') {
                expect(out[0].kind.note).toBe(60);
            }
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

    describe('processMidi octave_bias pitch mutation', () => {
        it('leaves pitch unchanged while octave_bias is at its base of 0', () => {
            const engine = new MutationEngine('octave-base');
            const out: MidiEvent[] = [];
            engine.processMidi([noteOn(0, 60, 100)], out, transport);
            if (out[0]?.kind.type === 'noteOn') {
                expect(out[0].kind.note).toBe(60);
            }
        });

        it('shifts a noteOn by the current octave_bias walk, and the matching noteOff carries the same shift', () => {
            const engine = new MutationEngine('octave-shift');
            engine.setParam('depth', 1);
            engine.setParam('rate', 10);
            runBeats(engine, 2); // drift octave_bias away from 0

            const onOut: MidiEvent[] = [];
            engine.processMidi([noteOn(0, 60, 100)], onOut, transport);
            // processMidi advances the walk at its start, so the value that was
            // actually applied is only knowable by reading it back afterward —
            // same reasoning the velocity clamp tests above already rely on.
            const appliedShift = Math.round(engine.__getTargetValuesForTest()[1]!.value * 12);
            const expectedNote = Math.max(0, Math.min(127, 60 + appliedShift));
            expect(onOut[0]?.kind.type).toBe('noteOn');
            if (onOut[0]?.kind.type === 'noteOn') {
                expect(onOut[0].kind.note).toBe(expectedNote);
            }

            // The walk keeps moving on the Off's own processMidi call, but the
            // Off must still carry the shift that was applied to its On, not
            // whatever octave_bias reads now.
            const offOut: MidiEvent[] = [];
            engine.processMidi([noteOff(0, 60)], offOut, transport);
            expect(offOut[0]?.kind.type).toBe('noteOff');
            if (offOut[0]?.kind.type === 'noteOff') {
                expect(offOut[0].kind.note).toBe(expectedNote);
            }
        });

        it('clamps a shifted note into the valid MIDI range', () => {
            const engine = new MutationEngine('octave-clamp');
            engine.setParam('depth', 1);
            engine.setParam('rate', 10);
            runBeats(engine, 20);

            const out: MidiEvent[] = [];
            engine.processMidi([noteOn(0, 120, 100)], out, transport);
            if (out[0]?.kind.type === 'noteOn') {
                expect(out[0].kind.note).toBeGreaterThanOrEqual(0);
                expect(out[0].kind.note).toBeLessThanOrEqual(127);
            }
        });

        it('correlates two overlapping same-pitch voices by their own noteInstanceId, not release order', () => {
            // Two Note Ons at the same pitch, overlapping, each carrying its own
            // noteInstanceId (as both the live and offline feeds do). The walk
            // moves between them, so each gets a DIFFERENT applied shift. Voice
            // "b"'s Off arrives first, before voice "a"'s Off — releasing out of
            // On order, same as On1/On2/Off2/Off1 in the wild.
            //
            // A pitch-composite key (channel/note only, no instance id) cannot
            // tell these two voices apart: both share note 60, so they queue on
            // the SAME FIFO. Releasing Off2 before Off1 would then shift Off2 by
            // shiftA (voice a's shift, dequeued first) and Off1 by shiftB —
            // cross-assigned. Keying by noteInstanceId keeps each voice's
            // correlation independent of the other's release order.
            const engine = new MutationEngine('overlap');
            engine.setParam('depth', 1);
            engine.setParam('rate', 10);

            runBeats(engine, 1);
            const onAOut: MidiEvent[] = [];
            engine.processMidi(
                [{ ...noteOn(0, 60, 100), trackId: 'track', noteInstanceId: 'voice-a' }],
                onAOut,
                transport
            );
            const shiftA = Math.round(engine.__getTargetValuesForTest()[1]!.value * 12);
            expect(onAOut).toHaveLength(1);

            runBeats(engine, 5);
            const onBOut: MidiEvent[] = [];
            engine.processMidi(
                [{ ...noteOn(0, 60, 100), trackId: 'track', noteInstanceId: 'voice-b' }],
                onBOut,
                transport
            );
            const shiftB = Math.round(engine.__getTargetValuesForTest()[1]!.value * 12);
            expect(onBOut).toHaveLength(1);
            // The fixture only proves anything if the two shifts differ from
            // each other AND from 0 — otherwise a cross-assignment would be
            // indistinguishable from a correct one.
            expect(shiftA).not.toBe(0);
            expect(shiftB).not.toBe(0);
            expect(shiftA).not.toBe(shiftB);

            const offBOut: MidiEvent[] = [];
            engine.processMidi(
                [{ ...noteOff(0, 60), trackId: 'track', noteInstanceId: 'voice-b' }],
                offBOut,
                transport
            );
            expect(offBOut[0]?.kind.type).toBe('noteOff');
            if (offBOut[0]?.kind.type === 'noteOff') {
                expect(offBOut[0].kind.note).toBe(60 + shiftB);
            }

            const offAOut: MidiEvent[] = [];
            engine.processMidi(
                [{ ...noteOff(0, 60), trackId: 'track', noteInstanceId: 'voice-a' }],
                offAOut,
                transport
            );
            expect(offAOut[0]?.kind.type).toBe('noteOff');
            if (offAOut[0]?.kind.type === 'noteOff') {
                expect(offAOut[0].kind.note).toBe(60 + shiftA);
            }
        });
    });

    describe('processMidi probability_offset gating', () => {
        it('never drops a note while probability_offset is at its base of 0', () => {
            const engine = new MutationEngine('prob-base');
            const out: MidiEvent[] = [];
            for (let index = 0; index < 20; index++) {
                engine.processMidi([noteOn(index, 60 + index, 100)], out, transport);
            }
            expect(out).toHaveLength(20);
        });

        it('thins the stream once the walk pushes probability_offset negative, dropping each Note Off alongside its dropped Note On', () => {
            const engine = new MutationEngine('prob-drift');
            engine.setParam('depth', 1);
            engine.setParam('rate', 10);
            // 60 beats of drift and 1000 notes: empirically the shortest drive
            // (for this fixed seed) that reliably visits negative
            // probability_offset territory at least once — the walk is
            // damped toward 0, so a shorter span can spend its entire
            // duration on the positive (never-drops) side by chance.
            runBeats(engine, 60);

            const notesSent = 1000;
            const onOutputs: MidiEvent[] = [];
            const offOutputs: MidiEvent[] = [];
            for (let index = 0; index < notesSent; index++) {
                const note = 20 + (index % 80); // spread keys; on/off pairs never overlap
                const onOut: MidiEvent[] = [];
                engine.processMidi([noteOn(index, note, 100)], onOut, transport);
                const offOut: MidiEvent[] = [];
                engine.processMidi([noteOff(index, note)], offOut, transport);
                onOutputs.push(...onOut);
                offOutputs.push(...offOut);
            }

            expect(onOutputs.length).toBeLessThan(notesSent);
            // Every surviving Note On has exactly one Note Off: the drop
            // decision suppresses the pair as a whole, never one side of it.
            expect(offOutputs.length).toBe(onOutputs.length);
        });

        it('is deterministic: two engines with the same seed and params drop the same notes', () => {
            const first = new MutationEngine('prob-det-a');
            const second = new MutationEngine('prob-det-b');
            for (const engine of [first, second]) {
                engine.setParam('depth', 1);
                engine.setParam('rate', 10);
            }
            runBeats(first, 20);
            runBeats(second, 20);

            const collect = (engine: MutationEngine): MidiEvent[] => {
                const collected: MidiEvent[] = [];
                for (let index = 0; index < 50; index++) {
                    const note = 20 + (index % 80);
                    const out: MidiEvent[] = [];
                    engine.processMidi([noteOn(index, note, 100)], out, transport);
                    collected.push(...out);
                }
                return collected;
            };

            expect(collect(first)).toEqual(collect(second));
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
            expect(engine.__getTargetValuesForTest()[0]!.value).toBe(0);

            runBeats(engine, 0.2); // crosses the first beat boundary
            expect(engine.__getTargetValuesForTest()[0]!.value).not.toBe(0);
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

            expect(highRate.__getTargetValuesForTest()).toEqual(standard.__getTargetValuesForTest());
            // 8 beats × 2 per beat = 16 steps — the walk actually moved.
            expect(standard.__getTargetValuesForTest()[0]!.value).not.toBe(0);
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

            expect(slow.__getTargetValuesForTest()).toEqual(fast.__getTargetValuesForTest());
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

            expect(ragged.__getTargetValuesForTest()).toEqual(even.__getTargetValuesForTest());
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

            expect(capped.__getTargetValuesForTest()).toEqual(reference.__getTargetValuesForTest());
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

            expect(overrun.__getTargetValuesForTest()).toEqual(reference.__getTargetValuesForTest());
        });
    });

    describe('mutateStep keeps targets within their clamped range', () => {
        it('never lets velocity_offset escape [-30, 30] after many steps', () => {
            const engine = new MutationEngine('range-vel');
            engine.setParam('rate', 10); // ten mutations per beat
            engine.setParam('depth', 1); // raw target value visible at depth 1
            runBeats(engine, 20); // 200 mutation steps
            // depth=1 so getTargetValues reports the raw clamped value.
            const raw = engine.__getTargetValuesForTest()[0]!.value;
            expect(raw).toBeGreaterThanOrEqual(-30);
            expect(raw).toBeLessThanOrEqual(30);
        });

        it('never lets octave_bias escape [-1, 1] after many steps', () => {
            const engine = new MutationEngine('range-octave');
            engine.setParam('rate', 10);
            engine.setParam('depth', 1);
            runBeats(engine, 20);
            const raw = engine.__getTargetValuesForTest()[1]!.value;
            expect(raw).toBeGreaterThanOrEqual(-1);
            expect(raw).toBeLessThanOrEqual(1);
        });
    });

    describe('reset clears live drift state but keeps configured params', () => {
        it('restores target values to their baseValue and zeroes the mutation phase', () => {
            const engine = new MutationEngine('reset-state');
            engine.setParam('rate', 10);
            engine.setParam('depth', 1);
            // Drift the targets.
            runBeats(engine, 1);
            expect(engine.__getTargetValuesForTest().some((t) => t.value !== 0)).toBe(true);

            engine.reset();
            // After reset every target.value is back at its baseValue — all
            // three targets have baseValue 0, so every reported value (raw
            // baseValue * depth) is 0 regardless of depth.
            const reported = engine.__getTargetValuesForTest();
            expect(reported[0]!.value).toBe(0);
            expect(reported[1]!.value).toBe(0);
            expect(reported[2]!.value).toBe(0);

            // The mutation phase is zeroed too: at one mutation per two beats,
            // a full beat of transport after the reset still must not step.
            engine.setParam('rate', 0.5);
            runBeats(engine, 1);
            expect(engine.__getTargetValuesForTest()[0]!.value).toBe(0);
        });

        it('clears queued pitch-shift and drop-decision correlation state', () => {
            // Mirrors NoteFilter.reset(): a noteOn processed just before a reset
            // (an all-notes-off, a discontinuity) may never see its matching
            // noteOff arrive. Left uncleared, that FIFO entry would still be
            // sitting at the head the next time an unrelated noteOn/noteOff
            // pair reuses the same channel/note key, and get read for the
            // wrong note. `size` is a black-box count across every key, so
            // this does not depend on which way the random walk happened to
            // move — a noteOn queues exactly one entry in each map whenever it
            // is not dropped, and a fresh engine's probability_offset is at
            // base 0 (never drops).
            const engine = new MutationEngine('reset-voices');
            const out: MidiEvent[] = [];
            engine.processMidi([noteOn(0, 60, 100)], out, transport);

            const internal = engine as unknown as {
                pitchVoices: { size: number };
                passDecisions: { size: number };
            };
            expect(internal.pitchVoices.size).toBe(1);
            expect(internal.passDecisions.size).toBe(1);

            engine.reset();

            expect(internal.pitchVoices.size).toBe(0);
            expect(internal.passDecisions.size).toBe(0);
        });
    });

    describe('resetParams restores configured depth and rate', () => {
        it('resets depth to 0.5', () => {
            // Every target's baseValue is 0, so a reset walk reports 0
            // regardless of depth — depth can only be observed through a
            // DRIFTED value. Compare against a sister engine explicitly
            // configured at depth 0.5: same seed, same rate, so the raw walk
            // is identical and only the depth-scaled report can differ.
            const engine = new MutationEngine('reset-params-depth');
            engine.setParam('depth', 1);
            engine.setParam('rate', 10);
            (engine as unknown as { resetParams: () => void }).resetParams();
            // resetParams resets BOTH depth and rate to their defaults (0.5,
            // 1) — hold rate at the sister's value so cadence is identical
            // and only the depth reset is under test.
            engine.setParam('rate', 10);

            const sister = new MutationEngine('reset-params-depth-sister');
            sister.setParam('depth', 0.5);
            sister.setParam('rate', 10);

            runBeats(engine, 1);
            runBeats(sister, 1);
            expect(engine.__getTargetValuesForTest()).toEqual(sister.__getTargetValuesForTest());
            expect(engine.__getTargetValuesForTest()[0]!.value).not.toBe(0);
        });

        it('resets rate to one mutation per beat', () => {
            const engine = new MutationEngine('reset-params-rate');
            engine.setParam('rate', 10); // ten mutations per beat
            engine.setParam('depth', 1);
            // Confirm the rate took effect: a tenth of a beat drifts the walk.
            runBeats(engine, 0.15);
            expect(engine.__getTargetValuesForTest()[0]!.value).not.toBe(0);

            (engine as unknown as { resetParams: () => void }).resetParams();
            // resetParams only resets depth/rate, NOT live target drift, so clear
            // the targets explicitly to detect the fresh cadence.
            engine.reset();
            engine.setParam('depth', 1);

            // Back at one mutation per beat: 0.9 beats must not step.
            runBeats(engine, 0.9);
            expect(engine.__getTargetValuesForTest()[0]!.value).toBe(0); // still base
            runBeats(engine, 0.2); // crosses the beat
            expect(engine.__getTargetValuesForTest()[0]!.value).not.toBe(0);
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
            expect(engine.__getTargetValuesForTest()[0]!.value).toBe(sister.__getTargetValuesForTest()[0]!.value);
        });

        it('clamps depth below 0 up to 0 (no mutation audible)', () => {
            const engine = new MutationEngine('depth-lo');
            engine.setParam('depth', -5);
            engine.setParam('rate', 10);
            runBeats(engine, 1);
            // depth=0 → every reported value is raw * 0 = 0 regardless of drift.
            // (JS may yield -0 for the velocity_offset product; treat ±0 as zero.)
            for (const target of engine.__getTargetValuesForTest()) {
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
            expect(engine.__getTargetValuesForTest()[0]!.value).toBe(0);
            runBeats(engine, 2); // crosses beat 10
            expect(engine.__getTargetValuesForTest()[0]!.value).not.toBe(0);
        });

        it('clamps rate above 10 down to 10 (ten mutations per beat)', () => {
            const engine = new MutationEngine('rate-hi');
            const ceiling = new MutationEngine('rate-hi');
            engine.setParam('rate', 999); // → clamped to 10
            ceiling.setParam('rate', 10);
            runBeats(engine, 4);
            runBeats(ceiling, 4);
            expect(engine.__getTargetValuesForTest()).toEqual(ceiling.__getTargetValuesForTest());
            expect(engine.__getTargetValuesForTest().some((t) => t.value !== 0)).toBe(true);
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

            expect(oneBigBlock.__getTargetValuesForTest()).toEqual(manySmall.__getTargetValuesForTest());
        });
    });

    describe('__getTargetValuesForTest', () => {
        it('reports the three mutation targets by name and base values', () => {
            // gate_mul is gone: it was written by the walk but never read by
            // processMidi or any other processor (audit residue, #2039).
            const engine = new MutationEngine('targets');
            const values = engine.__getTargetValuesForTest();
            expect(values.map((t) => t.name)).toEqual(['velocity_offset', 'octave_bias', 'probability_offset']);
            expect(values[0]!.value).toBe(0);
            expect(values[1]!.value).toBe(0);
            expect(values[2]!.value).toBe(0);
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
            for (let i = 0; i < 3; i++) {
                const half = engine.__getTargetValuesForTest()[i]!.value;
                const full = sister.__getTargetValuesForTest()[i]!.value;
                if (full !== 0) {
                    expect(half).toBeCloseTo(full / 2, 6);
                }
            }
        });
    });
});
