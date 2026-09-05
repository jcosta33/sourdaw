import { describe, expect, it } from 'vitest';

import { scheduleBuiltinSynthNote } from '../scheduleBuiltinSynthNote';

type ParamEvent = { method: string; value: number; time: number; param?: string };

function makeParam(events: ParamEvent[], param?: string) {
    return {
        value: 0,
        setValueAtTime: (value: number, time: number) =>
            events.push({ method: 'setValueAtTime', value, time, ...(param ? { param } : {}) }),
        linearRampToValueAtTime: (value: number, time: number) =>
            events.push({ method: 'linearRampToValueAtTime', value, time, ...(param ? { param } : {}) }),
        exponentialRampToValueAtTime: (value: number, time: number) =>
            events.push({ method: 'exponentialRampToValueAtTime', value, time, ...(param ? { param } : {}) }),
        setTargetAtTime: (value: number, time: number) =>
            events.push({ method: 'setTargetAtTime', value, time, ...(param ? { param } : {}) }),
    };
}

function makeFakeContext() {
    const events: ParamEvent[] = [];

    function makeGain() {
        return {
            gain: makeParam(events),
            connect: (destination: unknown) => destination,
            disconnect: () => {},
        };
    }

    function makeOscillator() {
        return {
            type: 'sawtooth',
            frequency: makeParam(events),
            detune: makeParam(events),
            connect: (destination: unknown) => destination,
            disconnect: () => {},
            start: () => {},
            stop: () => {},
            onended: null as null | (() => void),
        };
    }

    function makeFilter() {
        return {
            type: 'lowpass',
            frequency: makeParam(events, 'filterFrequency'),
            Q: makeParam(events),
            connect: (destination: unknown) => destination,
            disconnect: () => {},
        };
    }

    const ctx = {
        sampleRate: 48000,
        currentTime: 0,
        createGain: makeGain,
        createOscillator: makeOscillator,
        createBiquadFilter: makeFilter,
    } as unknown as BaseAudioContext;

    return { ctx, events };
}

const destination = { connect: () => {}, disconnect: () => {} } as unknown as AudioNode;

const baseBuiltinSynthParams = {
    waveform: 'sawtooth',
    attack: 0.5,
    decay: 0.2,
    sustain: 0.7,
    release: 0.3,
    filterCutoff: 5000,
    filterResonance: 1,
    filterType: 'lowpass',
    filterEnvAmount: 0,
    detune: 0,
    gain: 0.3,
    osc2Waveform: 'sawtooth',
    osc2Detune: 0,
    osc2Mix: 0,
    subOscLevel: 0,
    noiseLevel: 0,
    vibratoRate: 0,
    vibratoDepth: 0,
    vibratoDelay: 0.3,
    stereoSpread: 0,
    filterVelocitySensitivity: 0,
} satisfies Parameters<typeof scheduleBuiltinSynthNote>[0]['params'];

function scheduleWithVelocity(ctx: BaseAudioContext, velocity: number, startTime: number) {
    return scheduleBuiltinSynthNote({
        ctx,
        destination,
        pitch: 69,
        startTime,
        duration: 1,
        velocity,
        params: baseBuiltinSynthParams,
        clipGain: 1,
    });
}

/** A440 (pitch 69) shifted by `semitones`, in Hz. */
function frequencyAfterBend(semitones: number): number {
    return 440 * 2 ** (semitones / 12);
}

function scheduleWithBend(ctx: BaseAudioContext, mpe: Record<string, number> | undefined) {
    return scheduleBuiltinSynthNote({
        ctx,
        destination,
        pitch: 69,
        startTime: 0,
        duration: 1,
        velocity: 100,
        params: baseBuiltinSynthParams,
        mpe,
        clipGain: 1,
    });
}

// audit MD-8, review round 1 — this file used to hold its own
// `MPE_BEND_RANGE_SEMITONES = 48`, so a bend recorded on a controller set to
// ±12 played back four times deeper than it was performed. The range is the
// caller's now.
describe('scheduleBuiltinSynthNote pitch-bend depth', () => {
    function firstFrequency(events: ParamEvent[]): number {
        const event = events.find((candidate) => candidate.method === 'setValueAtTime' && candidate.value > 100);
        return event?.value ?? 0;
    }

    it('bends by the range the caller supplies, not a range of its own', () => {
        const { ctx, events } = makeFakeContext();

        // Half-scale bend at ±12 st is +6 semitones.
        scheduleWithBend(ctx, { pitchBend: 4096, pitchBendRangeSemitones: 12 });

        expect(firstFrequency(events)).toBeCloseTo(frequencyAfterBend(6), 6);
    });

    it('sounds a different pitch for the same wire delta at a different range', () => {
        const shallow = makeFakeContext();
        const deep = makeFakeContext();

        scheduleWithBend(shallow.ctx, { pitchBend: 4096, pitchBendRangeSemitones: 12 });
        scheduleWithBend(deep.ctx, { pitchBend: 4096, pitchBendRangeSemitones: 48 });

        expect(firstFrequency(shallow.events)).toBeCloseTo(frequencyAfterBend(6), 6);
        expect(firstFrequency(deep.events)).toBeCloseTo(frequencyAfterBend(24), 6);
    });

    it('leaves the pitch unbent when the caller supplies no range', () => {
        const { ctx, events } = makeFakeContext();

        scheduleWithBend(ctx, { pitchBend: 4096 });

        expect(firstFrequency(events)).toBeCloseTo(440, 6);
    });

    it('leaves the pitch unbent for a note with no bend', () => {
        const { ctx, events } = makeFakeContext();

        scheduleWithBend(ctx, undefined);

        expect(firstFrequency(events)).toBeCloseTo(440, 6);
    });
});

describe('scheduleBuiltinSynthNote filter velocity sensitivity', () => {
    function getFilterCutoff(events: ParamEvent[]): number {
        const event = events.find(
            (candidate) => candidate.param === 'filterFrequency' && candidate.method === 'setValueAtTime'
        );
        return event?.value ?? 0;
    }

    it('disables velocity sensitivity when filterVelocitySensitivity is 0 (cutoff invariant across velocities)', () => {
        const low = makeFakeContext();
        const high = makeFakeContext();

        scheduleBuiltinSynthNote({
            ctx: low.ctx,
            destination,
            pitch: 69,
            startTime: 0,
            duration: 1,
            velocity: 32,
            params: { ...baseBuiltinSynthParams, filterCutoff: 5000, filterVelocitySensitivity: 0 },
            clipGain: 1,
        });

        scheduleBuiltinSynthNote({
            ctx: high.ctx,
            destination,
            pitch: 69,
            startTime: 0,
            duration: 1,
            velocity: 127,
            params: { ...baseBuiltinSynthParams, filterCutoff: 5000, filterVelocitySensitivity: 0 },
            clipGain: 1,
        });

        const cutoffLow = getFilterCutoff(low.events);
        const cutoffHigh = getFilterCutoff(high.events);

        expect(cutoffLow).toBe(5000);
        expect(cutoffHigh).toBe(5000);
        expect(cutoffLow).toBe(cutoffHigh);
    });

    it('scales filter cutoff linearly with velocity when filterVelocitySensitivity is 1', () => {
        const { ctx, events } = makeFakeContext();

        scheduleBuiltinSynthNote({
            ctx,
            destination,
            pitch: 69,
            startTime: 0,
            duration: 1,
            velocity: 63.5,
            params: { ...baseBuiltinSynthParams, filterCutoff: 5000, filterVelocitySensitivity: 1 },
            clipGain: 1,
        });

        const cutoff = getFilterCutoff(events);
        expect(cutoff).toBe(2500);
    });

    it('is continuous near zero sensitivity without jumping down at 0', () => {
        const zeroSens = makeFakeContext();
        const nearZeroSens = makeFakeContext();

        scheduleBuiltinSynthNote({
            ctx: zeroSens.ctx,
            destination,
            pitch: 69,
            startTime: 0,
            duration: 1,
            velocity: 32,
            params: { ...baseBuiltinSynthParams, filterCutoff: 5000, filterVelocitySensitivity: 0 },
            clipGain: 1,
        });

        scheduleBuiltinSynthNote({
            ctx: nearZeroSens.ctx,
            destination,
            pitch: 69,
            startTime: 0,
            duration: 1,
            velocity: 32,
            params: { ...baseBuiltinSynthParams, filterCutoff: 5000, filterVelocitySensitivity: 0.001 },
            clipGain: 1,
        });

        const cutoffZero = getFilterCutoff(zeroSens.events);
        const cutoffNearZero = getFilterCutoff(nearZeroSens.events);

        expect(Math.abs(cutoffNearZero - cutoffZero)).toBeLessThan(10);
    });

    it('preserves legacy velocity scaling when filterVelocitySensitivity is undefined', () => {
        const { ctx, events } = makeFakeContext();

        scheduleBuiltinSynthNote({
            ctx,
            destination,
            pitch: 69,
            startTime: 0,
            duration: 1,
            velocity: 32,
            params: {
                ...baseBuiltinSynthParams,
                filterCutoff: 5000,
                filterVelocitySensitivity: undefined as unknown as number,
            },
            clipGain: 1,
        });

        const cutoff = getFilterCutoff(events);
        const expected = 5000 * (0.3 + 0.7 * (32 / 127));
        expect(cutoff).toBeCloseTo(expected, 6);
    });
});

describe('scheduleBuiltinSynthNote', () => {
    const startTime = 10;

    it('should attach the amplitude envelope for smooth note release', () => {
        const { ctx } = makeFakeContext();

        const oscillator = scheduleWithVelocity(ctx, 100, 0);

        expect(oscillator._env).toBeDefined();
        expect(oscillator._env).not.toBeNull();
        expect(typeof oscillator._env.gain.setTargetAtTime).toBe('function');
    });

    it('should not schedule envelope or filter events before the note start', () => {
        const { ctx, events } = makeFakeContext();

        scheduleWithVelocity(ctx, 200, startTime);

        const earliest = Math.min(...events.map((event) => event.time));
        expect(earliest).toBeGreaterThanOrEqual(startTime);
    });

    it('should schedule the attack ramp at or after the note start', () => {
        const { ctx, events } = makeFakeContext();

        scheduleWithVelocity(ctx, 200, startTime);

        const attackRamp = events.find((event) => event.method === 'linearRampToValueAtTime' && event.value > 0);
        expect(attackRamp).toBeDefined();
        expect(attackRamp?.time).toBeGreaterThanOrEqual(startTime);
    });

    it('should clamp negative velocity without scheduling past events', () => {
        const { ctx, events } = makeFakeContext();

        scheduleWithVelocity(ctx, -50, startTime);

        const earliest = Math.min(...events.map((event) => event.time));
        expect(earliest).toBeGreaterThanOrEqual(startTime);
    });

    it('should treat over-range velocity like maximum MIDI velocity', () => {
        const over = makeFakeContext();
        scheduleWithVelocity(over.ctx, 200, startTime);
        const maximum = makeFakeContext();
        scheduleWithVelocity(maximum.ctx, 127, startTime);

        expect(over.events).toEqual(maximum.events);
    });
});
