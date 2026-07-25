import { describe, expect, it } from 'vitest';

import { scheduleBuiltinSynthNote } from '../scheduleBuiltinSynthNote';

type ParamEvent = { method: string; value: number; time: number };

function makeParam(events: ParamEvent[]) {
    return {
        value: 0,
        setValueAtTime: (value: number, time: number) => events.push({ method: 'setValueAtTime', value, time }),
        linearRampToValueAtTime: (value: number, time: number) =>
            events.push({ method: 'linearRampToValueAtTime', value, time }),
        exponentialRampToValueAtTime: (value: number, time: number) =>
            events.push({ method: 'exponentialRampToValueAtTime', value, time }),
        setTargetAtTime: (value: number, time: number) => events.push({ method: 'setTargetAtTime', value, time }),
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
            frequency: makeParam(events),
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
