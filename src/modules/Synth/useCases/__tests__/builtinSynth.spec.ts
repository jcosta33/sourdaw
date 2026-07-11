import { describe, it, expect } from 'vitest';

import { type SynthParams } from '#/modules/AudioEngine/useCases';

import { getSynthParamsFromDevices } from '../getSynthParamsFromDevices';
import { scheduleNote } from '../scheduleNote';
import { scheduleNoteOffline } from '../scheduleNoteOffline';

const subject = { getSynthParamsFromDevices, scheduleNote, scheduleNoteOffline };

// --- Minimal fake Web Audio graph ---------------------------------------
// jsdom has no Web Audio APIs and the global mock only stubs createGain.
// scheduleNote needs oscillators, a biquad filter, stereo panners and a
// noise buffer source. This fake records every AudioParam event time so a
// test can assert that nothing is scheduled before the note's startTime
// (the velocity-clamp bug scheduled envelope events in the past) and that
// the returned oscillator exposes the amplitude-envelope GainNode.

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
        cancelScheduledValues: (time: number) => events.push({ method: 'cancelScheduledValues', value: 0, time }),
    };
}

type FakeContext = {
    ctx: BaseAudioContext;
    /** All AudioParam events recorded across every node created in this graph. */
    events: ParamEvent[];
    /** start()/stop() times recorded on every scheduled source. */
    sourceStarts: number[];
    sourceStops: number[];
};

function makeFakeContext(sampleRate = 48000): FakeContext {
    const events: ParamEvent[] = [];
    const sourceStarts: number[] = [];
    const sourceStops: number[] = [];

    function makeGain() {
        return {
            gain: makeParam(events),
            connect: (dest: unknown) => dest,
            disconnect: () => {},
        };
    }

    function makeOscillator() {
        return {
            type: 'sawtooth',
            frequency: makeParam(events),
            detune: makeParam(events),
            connect: (dest: unknown) => dest,
            disconnect: () => {},
            start: (t: number) => sourceStarts.push(t),
            stop: (t: number) => sourceStops.push(t),
            onended: null as null | (() => void),
        };
    }

    function makeFilter() {
        return {
            type: 'lowpass',
            frequency: makeParam(events),
            Q: makeParam(events),
            connect: (dest: unknown) => dest,
            disconnect: () => {},
        };
    }

    function makeBufferSource() {
        return {
            buffer: null,
            connect: (dest: unknown) => dest,
            disconnect: () => {},
            start: (t: number) => sourceStarts.push(t),
            stop: (t: number) => sourceStops.push(t),
        };
    }

    const ctx = {
        sampleRate,
        currentTime: 0,
        createGain: makeGain,
        createOscillator: makeOscillator,
        createBiquadFilter: makeFilter,
        createBufferSource: makeBufferSource,
    } as unknown as BaseAudioContext;

    return { ctx, events, sourceStarts, sourceStops };
}

const destination = { connect: () => {}, disconnect: () => {} } as unknown as AudioNode;

const baseParams: SynthParams = {
    waveform: 'sawtooth',
    attack: 0.5, // large attack so velAttack sign is easy to detect
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
};

describe('builtinSynth — exports', () => {
    it('exports getSynthParamsFromDevices, scheduleNote, scheduleNoteOffline', () => {
        expect(typeof subject.getSynthParamsFromDevices).toBe('function');
        expect(typeof subject.scheduleNote).toBe('function');
        expect(typeof subject.scheduleNoteOffline).toBe('function');
    });
});

describe('builtinSynth.scheduleNote — _env attachment (smooth-release seam)', () => {
    it('attaches the amplitude-envelope GainNode as _env on the returned oscillator', () => {
        const { ctx } = makeFakeContext();
        const osc = subject.scheduleNote(ctx, destination, 69, 0, 1.0, 100, baseParams);

        // The note-off paths (audition / live MIDI / reset) gate the exponential
        // smooth release on osc._env. If it is undefined the release is dead and
        // every note-off hard-stops. It must be a GainNode-shaped object.
        expect(osc._env).toBeDefined();
        expect(osc._env).not.toBeNull();
        expect(typeof osc._env.gain.setTargetAtTime).toBe('function');
    });
});

describe('builtinSynth.scheduleNote — velocity clamp', () => {
    const startTime = 10;

    it('never schedules envelope/filter events before startTime for out-of-range velocity', () => {
        const { ctx, events } = makeFakeContext();
        // velocity 200 > 190.5 makes the unclamped velAttack negative, so the
        // attack-end ramp lands before startTime.
        subject.scheduleNote(ctx, destination, 69, startTime, 1.0, 200, baseParams);

        const earliest = Math.min(...events.map((e) => e.time));
        expect(earliest).toBeGreaterThanOrEqual(startTime);
    });

    it('schedules the attack-end ramp at or after startTime (velAttack >= 0)', () => {
        const { ctx, events } = makeFakeContext();
        subject.scheduleNote(ctx, destination, 69, startTime, 1.0, 200, baseParams);

        // The amplitude attack ramp targets the peak gain via linearRampToValueAtTime.
        const attackRamp = events.find((e) => e.method === 'linearRampToValueAtTime' && e.value > 0);
        expect(attackRamp).toBeDefined();
        expect(attackRamp!.time).toBeGreaterThanOrEqual(startTime);
    });

    it('clamps negative velocity to 0 (peak gain non-negative, no past events)', () => {
        const { ctx, events } = makeFakeContext();
        subject.scheduleNote(ctx, destination, 69, startTime, 1.0, -50, baseParams);

        const earliest = Math.min(...events.map((e) => e.time));
        expect(earliest).toBeGreaterThanOrEqual(startTime);
    });

    it('treats clamped over-range velocity identically to the max in-range velocity', () => {
        const over = makeFakeContext();
        subject.scheduleNote(over.ctx, destination, 69, startTime, 1.0, 200, baseParams);
        const max = makeFakeContext();
        subject.scheduleNote(max.ctx, destination, 69, startTime, 1.0, 127, baseParams);

        expect(over.events).toEqual(max.events);
    });
});

describe('builtinSynth.scheduleNoteOffline — velocity clamp', () => {
    const startTime = 10;

    it('never schedules events before startTime for out-of-range velocity', () => {
        const { ctx, events } = makeFakeContext();
        subject.scheduleNoteOffline(ctx, destination, 69, startTime, 1.0, 200, baseParams);

        const earliest = Math.min(...events.map((e) => e.time));
        expect(earliest).toBeGreaterThanOrEqual(startTime);
    });

    it('treats clamped over-range velocity identically to the max in-range velocity', () => {
        const over = makeFakeContext();
        subject.scheduleNoteOffline(over.ctx, destination, 69, startTime, 1.0, 200, baseParams);
        const max = makeFakeContext();
        subject.scheduleNoteOffline(max.ctx, destination, 69, startTime, 1.0, 127, baseParams);

        expect(over.events).toEqual(max.events);
    });
});
