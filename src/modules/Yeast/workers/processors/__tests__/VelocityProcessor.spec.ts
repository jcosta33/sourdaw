import { describe, it, expect } from 'vitest';

import { type MidiEvent, type TransportInfo } from '../../../models/MidiEvent';
import { VelocityProcessor } from '../VelocityProcessor';

const transport: TransportInfo = {
    isPlaying: true,
    ppqPosition: 0,
    bpm: 120,
    sampleRate: 48000,
    barIndex: 0,
    beatInBar: 0,
    timeSigNum: 4,
    timeSigDen: 4,
    loopEnabled: false,
    loopStartPpq: 0,
    loopEndPpq: 0,
};
const note_on = (t: number, n: number, v = 100): MidiEvent => ({
    timeSamples: t,
    kind: { type: 'noteOn', channel: 0, note: n, velocity: v },
});
const note_off = (t: number, n: number): MidiEvent => ({
    timeSamples: t,
    kind: { type: 'noteOff', channel: 0, note: n },
});

/** Independent re-derivation of the clamped/rounded output the processor emits. */
function clampRound(v: number): number {
    return Math.max(1, Math.min(127, Math.round(v)));
}

function processOnce(vp: VelocityProcessor, vel: number): number {
    const out: MidiEvent[] = [];
    vp.processMidi([note_on(0, 60, vel)], out, transport);
    if (out[0]?.kind.type === 'noteOn') {
        return out[0].kind.velocity;
    }
    throw new Error('expected noteOn output');
}

describe('VelocityProcessor', () => {
    describe('construction', () => {
        it('uses the provided id when given', () => {
            const vp = new VelocityProcessor('explicit-id');
            expect(vp.id).toBe('explicit-id');
        });

        it('generates a vel-prefixed id when none is provided', () => {
            const vp = new VelocityProcessor();
            // Generated id is `vel-${Date.now()}` — a numeric millisecond stamp
            // under the "vel-" prefix, unique per construction tick.
            expect(vp.id).toMatch(/^vel-\d+$/);
            expect(vp.name).toBe('Velocity');
        });
    });

    describe('mode routing', () => {
        it('passthrough mode preserves velocity exactly', () => {
            const vp = new VelocityProcessor('t1');
            expect(processOnce(vp, 80)).toBe(80);
        });

        it('fixed mode sets every note to the configured velocity', () => {
            const vp = new VelocityProcessor('t2');
            vp.setParam('mode', 1); // fixed
            vp.setParam('fixed_vel', 64);
            expect(processOnce(vp, 100)).toBe(64);
            expect(processOnce(vp, 1)).toBe(64);
        });

        it('compress mode pulls velocity toward the 64 center', () => {
            const vp = new VelocityProcessor('t3');
            vp.setParam('mode', 2); // compress
            vp.setParam('compress_amount', 0.5);
            // 64 + (127 - 64) * 0.5 = 95.5 → 96
            expect(processOnce(vp, 127)).toBe(clampRound(64 + (127 - 64) * 0.5));
        });

        it('expand mode pushes velocity away from the 64 center', () => {
            const vp = new VelocityProcessor('t4');
            vp.setParam('mode', 3); // expand
            vp.setParam('compress_amount', 1.5);
            const expected = clampRound(64 + (80 - 64) * 1.5);
            expect(processOnce(vp, 80)).toBe(expected);
        });
    });

    describe('curve response shapes (DSP-derived)', () => {
        it('linear curve is identity (out === in)', () => {
            const vp = new VelocityProcessor('c-lin');
            vp.setParam('mode', 4); // curve
            vp.setParam('curve', 0); // linear
            expect(processOnce(vp, 100)).toBe(100);
        });

        it('soft curve applies a sqrt response curve', () => {
            const vp = new VelocityProcessor('c-soft');
            vp.setParam('mode', 4);
            vp.setParam('curve', 1); // soft → sqrt(norm) * 127
            expect(processOnce(vp, 64)).toBe(clampRound(Math.sqrt(64 / 127) * 127));
        });

        it('hard curve applies a squared response curve', () => {
            const vp = new VelocityProcessor('c-hard');
            vp.setParam('mode', 4);
            vp.setParam('curve', 2); // hard → norm² * 127
            expect(processOnce(vp, 64)).toBe(clampRound((64 / 127) ** 2 * 127));
        });

        it('sCurve applies the lower-half 2·norm² response for v < 63.5', () => {
            const vp = new VelocityProcessor('c-scurve-lo');
            vp.setParam('mode', 4);
            vp.setParam('curve', 3); // sCurve
            // v=32 → norm ≈ 0.252 → norm < 0.5 → mapped = 2 * norm²
            const norm = 32 / 127;
            expect(processOnce(vp, 32)).toBe(clampRound(2 * norm * norm * 127));
        });

        it('sCurve applies the upper-half 1 − 2·(1−norm)² response for v > 63.5', () => {
            const vp = new VelocityProcessor('c-scurve-hi');
            vp.setParam('mode', 4);
            vp.setParam('curve', 3); // sCurve
            // v=100 → norm ≈ 0.787 → norm >= 0.5 → mapped = 1 - 2*(1-norm)²
            const norm = 100 / 127;
            expect(processOnce(vp, 100)).toBe(clampRound((1 - 2 * (1 - norm) ** 2) * 127));
        });
    });

    describe('random mode', () => {
        it('produces velocities within the configured [min, max] range', () => {
            const vp = new VelocityProcessor('r1');
            vp.setParam('mode', 5); // random
            vp.setParam('random_min', 50);
            vp.setParam('random_max', 80);
            for (let i = 0; i < 20; i++) {
                const v = processOnce(vp, 100);
                expect(v).toBeGreaterThanOrEqual(50);
                expect(v).toBeLessThanOrEqual(80);
            }
        });
    });

    describe('non-noteOn passthrough', () => {
        it('passes noteOff events through unchanged', () => {
            const vp = new VelocityProcessor('t8');
            const input = [note_off(0, 60)];
            const out: MidiEvent[] = [];
            vp.processMidi(input, out, transport);
            expect(out).toContainEqual(input[0]);
        });
    });

    describe('output clamping', () => {
        it('clamps a fixed velocity above 127 down to 127', () => {
            const vp = new VelocityProcessor('clamp-hi');
            vp.setParam('mode', 1);
            vp.setParam('fixed_vel', 200);
            expect(processOnce(vp, 50)).toBe(127);
        });

        it('clamps a fixed velocity below 1 up to 1', () => {
            const vp = new VelocityProcessor('clamp-lo');
            vp.setParam('mode', 1);
            vp.setParam('fixed_vel', -5);
            expect(processOnce(vp, 50)).toBe(1);
        });

        it('clamps compress_amount to the [0, 3] range', () => {
            const vp = new VelocityProcessor('clamp-comp');
            vp.setParam('mode', 2);
            // Above max → clamped to 3 → 64 + (100-64)*3 = 172 → clamped to 127.
            vp.setParam('compress_amount', 99);
            expect(processOnce(vp, 100)).toBe(127);
        });
    });

    describe('resetParams', () => {
        it('restores the default passthrough mode and params after mutation', () => {
            const vp = new VelocityProcessor('reset');
            vp.setParam('mode', 1);
            vp.setParam('fixed_vel', 1);
            vp.setParam('compress_amount', 3);
            vp.setParam('curve', 3);
            vp.setParam('random_min', 1);
            vp.setParam('random_max', 1);
            // Access protected reset via unknown cast.
            (vp as unknown as { resetParams: () => void }).resetParams();
            // After reset, mode is passthrough → velocity preserved.
            expect(processOnce(vp, 77)).toBe(77);
        });
    });

    describe('inverted random_min / random_max', () => {
        it('reads an inverted range as the same range instead of emitting NaN', () => {
            // No UI reaches this pair; a stored project, a CRDT merge, or an
            // AI-authored action can. With max = min - 1 the span
            // `max - min + 1` is 0, so `rngState % 0` is NaN and the clamp
            // propagates it — a NaN velocity in the host's note stream.
            const vp = new VelocityProcessor('random-inverted-degenerate');
            vp.setParam('mode', 5); // random
            vp.setParam('random_min', 90);
            vp.setParam('random_max', 89);
            for (let index = 0; index < 32; index++) {
                const velocity = processOnce(vp, 100);
                expect(Number.isNaN(velocity)).toBe(false);
                expect(velocity).toBeGreaterThanOrEqual(89);
                expect(velocity).toBeLessThanOrEqual(90);
            }
        });

        it('produces the same draws as the equivalent ordered range', () => {
            const inverted = new VelocityProcessor('random-inverted');
            const ordered = new VelocityProcessor('random-ordered');
            inverted.setParam('mode', 5);
            inverted.setParam('random_min', 120);
            inverted.setParam('random_max', 40);
            ordered.setParam('mode', 5);
            ordered.setParam('random_min', 40);
            ordered.setParam('random_max', 120);

            for (let index = 0; index < 32; index++) {
                const drawn = processOnce(inverted, 100);
                expect(drawn).toBe(processOnce(ordered, 100));
                expect(drawn).toBeGreaterThanOrEqual(40);
                expect(drawn).toBeLessThanOrEqual(120);
            }
        });
    });

    describe('setParam fallback defaults', () => {
        it('falls back to passthrough when the mode index is out of range', () => {
            const vp = new VelocityProcessor('fb-mode');
            vp.setParam('mode', 1); // fixed first
            vp.setParam('fixed_vel', 50);
            // index 99 is out of range → undefined ?? 'passthrough' → passthrough.
            vp.setParam('mode', 99);
            expect(processOnce(vp, 88)).toBe(88);
        });

        it('falls back to linear when the curve index is out of range', () => {
            const vp = new VelocityProcessor('fb-curve');
            vp.setParam('mode', 4); // curve
            vp.setParam('curve', 99); // out of range → linear
            // linear curve is identity.
            expect(processOnce(vp, 95)).toBe(95);
        });
    });
});
