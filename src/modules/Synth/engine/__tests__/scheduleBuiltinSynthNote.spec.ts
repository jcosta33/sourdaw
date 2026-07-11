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
