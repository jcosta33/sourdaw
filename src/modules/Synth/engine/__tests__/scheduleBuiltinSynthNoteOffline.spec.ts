import { describe, expect, it, vi } from 'vitest';

import * as builtinScheduler from '../scheduleBuiltinSynthNote';
import { scheduleBuiltinSynthNoteOffline } from '../scheduleBuiltinSynthNoteOffline';

type ParamEvent = { method: string; value: number; time: number };

function makeParam(events: ParamEvent[]) {
    return {
        value: 0,
        setValueAtTime: (value: number, time: number) => events.push({ method: 'setValueAtTime', value, time }),
        linearRampToValueAtTime: (value: number, time: number) =>
            events.push({ method: 'linearRampToValueAtTime', value, time }),
        exponentialRampToValueAtTime: (value: number, time: number) =>
            events.push({ method: 'exponentialRampToValueAtTime', value, time }),
    };
}

function makeFakeContext() {
    const events: ParamEvent[] = [];

    function makeGain() {
        return {
            gain: makeParam(events),
            connect: (destination: unknown) => destination,
        };
    }

    function makeOscillator() {
        return {
            type: 'sawtooth',
            frequency: makeParam(events),
            detune: makeParam(events),
            connect: (destination: unknown) => destination,
            start: () => {},
            stop: () => {},
        };
    }

    function makeFilter() {
        return {
            type: 'lowpass',
            frequency: makeParam(events),
            Q: makeParam(events),
            connect: (destination: unknown) => destination,
        };
    }

    const ctx = {
        createGain: makeGain,
        createOscillator: makeOscillator,
        createBiquadFilter: makeFilter,
    } as unknown as BaseAudioContext;

    return { ctx, events };
}

const destination = { connect: () => {} } as unknown as AudioNode;

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
} satisfies Parameters<typeof scheduleBuiltinSynthNoteOffline>[0]['params'];

function scheduleWithVelocity(ctx: BaseAudioContext, velocity: number, startTime: number): void {
    scheduleBuiltinSynthNoteOffline({
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

describe('scheduleBuiltinSynthNoteOffline', () => {
    const startTime = 10;

    it('should not schedule events before the note start', () => {
        const { ctx, events } = makeFakeContext();

        scheduleWithVelocity(ctx, 200, startTime);

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

    it('delegates every offline note to the full monitored graph', () => {
        const graph = vi.spyOn(builtinScheduler, 'scheduleBuiltinSynthNote').mockImplementation(() => {
            return {} as OscillatorNode & { _env: GainNode };
        });
        const mpe = { pressure: 90, slide: 45, pitchBend: 4_096, pitchBendRangeSemitones: 12 };
        const { ctx } = makeFakeContext();

        scheduleBuiltinSynthNoteOffline({
            ctx,
            destination,
            pitch: 69,
            startTime: 2,
            duration: 1.5,
            velocity: 100,
            params: baseBuiltinSynthParams,
            mpe,
            clipGain: 0.25,
        });

        expect(graph).toHaveBeenCalledWith({
            ctx,
            destination,
            pitch: 69,
            startTime: 2,
            duration: 1.5,
            velocity: 100,
            params: baseBuiltinSynthParams,
            mpe,
            clipGain: 0.25,
        });
        graph.mockRestore();
    });
});
