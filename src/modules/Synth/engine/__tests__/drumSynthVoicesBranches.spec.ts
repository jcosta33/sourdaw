import { describe, it, expect } from 'vitest';

import { scheduleDrumVoice } from '../drumSynthVoices';

/**
 * Voice-specific behavior specs. The existing drumSynthVoices.spec.ts only tests
 * teardown disconnection. These specs upgrade the fake context to record
 * setValueAtTime / exponentialRampToValueAtTime calls and assert per-voice
 * scheduling correctness: hi-hat open vs closed decay, tom/conga pitch→freq
 * maps, velocity scaling, and oscillator types.
 */

type ParamCall = {
    method: 'setValueAtTime' | 'linearRampToValueAtTime' | 'exponentialRampToValueAtTime';
    value: number;
    time: number;
};

type FakeParam = {
    value: number;
    calls: ParamCall[];
    setValueAtTime: (value: number, time: number) => void;
    linearRampToValueAtTime: (value: number, time: number) => void;
    exponentialRampToValueAtTime: (value: number, time: number) => void;
};

type FakeOscillator = {
    type: string;
    frequency: FakeParam;
    start: (time: number) => void;
    stop: (time: number) => void;
    onended: (() => void) | null;
    connect: (dest: unknown) => unknown;
    disconnect: () => void;
};

type FakeBufferSource = {
    buffer: { getChannelData: () => Float32Array } | null;
    start: (time: number) => void;
    stop: (time: number) => void;
    onended: (() => void) | null;
    connect: (dest: unknown) => unknown;
    disconnect: () => void;
};

type FakeGain = {
    gain: FakeParam;
    connect: (dest: unknown) => unknown;
    disconnect: () => void;
};

type FakeFilter = {
    type: string;
    frequency: FakeParam;
    Q: FakeParam;
    connect: (dest: unknown) => unknown;
    disconnect: () => void;
};

type FakeShaper = {
    curve: Float32Array | null;
    oversample: string;
    connect: (dest: unknown) => unknown;
    disconnect: () => void;
};

type RecordedContext = {
    ctx: BaseAudioContext;
    oscillators: FakeOscillator[];
    bufferSources: FakeBufferSource[];
    gains: FakeGain[];
    filters: FakeFilter[];
    shapers: FakeShaper[];
};

function makeParam(): FakeParam {
    const calls: ParamCall[] = [];
    return {
        value: 0,
        calls,
        setValueAtTime: (value, time) => calls.push({ method: 'setValueAtTime', value, time }),
        linearRampToValueAtTime: (value, time) => calls.push({ method: 'linearRampToValueAtTime', value, time }),
        exponentialRampToValueAtTime: (value, time) =>
            calls.push({ method: 'exponentialRampToValueAtTime', value, time }),
    };
}

function makeFakeContext(sampleRate = 48000): RecordedContext {
    const oscillators: FakeOscillator[] = [];
    const bufferSources: FakeBufferSource[] = [];
    const gains: FakeGain[] = [];
    const filters: FakeFilter[] = [];
    const shapers: FakeShaper[] = [];

    function makeOscillator(): FakeOscillator {
        const osc: FakeOscillator = {
            type: 'sine',
            frequency: makeParam(),
            start: () => {},
            stop: () => {},
            onended: null,
            connect: (dest: unknown) => dest,
            disconnect: () => {},
        };
        oscillators.push(osc);
        return osc;
    }

    function makeBufferSource(): FakeBufferSource {
        const src: FakeBufferSource = {
            buffer: null,
            start: () => {},
            stop: () => {},
            onended: null,
            connect: (dest: unknown) => dest,
            disconnect: () => {},
        };
        bufferSources.push(src);
        return src;
    }

    function makeGain(): FakeGain {
        const gain: FakeGain = {
            gain: makeParam(),
            connect: (dest: unknown) => dest,
            disconnect: () => {},
        };
        gains.push(gain);
        return gain;
    }

    function makeFilter(): FakeFilter {
        const filter: FakeFilter = {
            type: 'lowpass',
            frequency: makeParam(),
            Q: makeParam(),
            connect: (dest: unknown) => dest,
            disconnect: () => {},
        };
        filters.push(filter);
        return filter;
    }

    function makeShaper(): FakeShaper {
        const shaper: FakeShaper = {
            curve: null,
            oversample: 'none',
            connect: (dest: unknown) => dest,
            disconnect: () => {},
        };
        shapers.push(shaper);
        return shaper;
    }

    function makeBuffer(_channels: number, length: number) {
        const data = new Float32Array(length);
        return { getChannelData: () => data };
    }

    const ctx = {
        sampleRate,
        currentTime: 0,
        createOscillator: makeOscillator,
        createBufferSource: makeBufferSource,
        createGain: makeGain,
        createBiquadFilter: makeFilter,
        createWaveShaper: makeShaper,
        createBuffer: makeBuffer,
    } as unknown as BaseAudioContext;

    return { ctx, oscillators, bufferSources, gains, filters, shapers };
}

const DEST = { connect: () => {}, disconnect: () => {} } as unknown as AudioNode;

function findGainCalls(rec: RecordedContext, index = 0): ParamCall[] {
    return rec.gains[index]!.gain.calls;
}

function findFreqCalls(rec: RecordedContext, index = 0): ParamCall[] {
    return rec.oscillators[index]!.frequency.calls;
}

describe('scheduleDrumVoice — hi-hat open vs closed decay', () => {
    it('closed hi-hat has a short 0.06s decay', () => {
        const rec = makeFakeContext();
        scheduleDrumVoice(rec.ctx, DEST, 'closed-hh', 0, 100);
        // The gain envelope's exponentialRamp target time reveals decayTime.
        const gainCalls = findGainCalls(rec, 0);
        const ramp = gainCalls.find((c) => c.method === 'exponentialRampToValueAtTime' && c.value === 0.001);
        expect(ramp).toBeDefined();
        expect(ramp!.time).toBeCloseTo(0.06, 2);
    });

    it('open hi-hat has a longer 0.4s decay', () => {
        const rec = makeFakeContext();
        scheduleDrumVoice(rec.ctx, DEST, 'open-hh', 0, 100);
        const gainCalls = findGainCalls(rec, 0);
        const ramp = gainCalls.find((c) => c.method === 'exponentialRampToValueAtTime' && c.value === 0.001);
        expect(ramp).toBeDefined();
        expect(ramp!.time).toBeCloseTo(0.4, 2);
    });
});

describe('scheduleDrumVoice — tom pitch-to-frequency map', () => {
    it('tom-low sweeps from 120 Hz down to 70 Hz', () => {
        const rec = makeFakeContext();
        scheduleDrumVoice(rec.ctx, DEST, 'tom-low', 0, 100);
        const freqCalls = findFreqCalls(rec, 0);
        const set = freqCalls.find((c) => c.method === 'setValueAtTime');
        const ramp = freqCalls.find((c) => c.method === 'exponentialRampToValueAtTime');
        expect(set!.value).toBe(120);
        expect(ramp!.value).toBe(70);
    });

    it('tom-mid sweeps from 165 Hz down to 100 Hz', () => {
        const rec = makeFakeContext();
        scheduleDrumVoice(rec.ctx, DEST, 'tom-mid', 0, 100);
        const freqCalls = findFreqCalls(rec, 0);
        const set = freqCalls.find((c) => c.method === 'setValueAtTime');
        const ramp = freqCalls.find((c) => c.method === 'exponentialRampToValueAtTime');
        expect(set!.value).toBe(165);
        expect(ramp!.value).toBe(100);
    });

    it('tom-high sweeps from 220 Hz down to 140 Hz', () => {
        const rec = makeFakeContext();
        scheduleDrumVoice(rec.ctx, DEST, 'tom-high', 0, 100);
        const freqCalls = findFreqCalls(rec, 0);
        const set = freqCalls.find((c) => c.method === 'setValueAtTime');
        const ramp = freqCalls.find((c) => c.method === 'exponentialRampToValueAtTime');
        expect(set!.value).toBe(220);
        expect(ramp!.value).toBe(140);
    });
});

describe('scheduleDrumVoice — conga pitch-to-frequency map', () => {
    it('conga-low starts at 300 Hz (200*1.5) and ramps to 200 Hz', () => {
        const rec = makeFakeContext();
        scheduleDrumVoice(rec.ctx, DEST, 'conga-low', 0, 100);
        const freqCalls = findFreqCalls(rec, 0);
        const set = freqCalls.find((c) => c.method === 'setValueAtTime');
        const ramp = freqCalls.find((c) => c.method === 'exponentialRampToValueAtTime');
        expect(set!.value).toBe(300);
        expect(ramp!.value).toBe(200);
    });

    it('conga-mid starts at 465 Hz (310*1.5) and ramps to 310 Hz', () => {
        const rec = makeFakeContext();
        scheduleDrumVoice(rec.ctx, DEST, 'conga-mid', 0, 100);
        const freqCalls = findFreqCalls(rec, 0);
        const set = freqCalls.find((c) => c.method === 'setValueAtTime');
        const ramp = freqCalls.find((c) => c.method === 'exponentialRampToValueAtTime');
        expect(set!.value).toBe(465);
        expect(ramp!.value).toBe(310);
    });

    it('conga-high starts at 630 Hz (420*1.5) and ramps to 420 Hz', () => {
        const rec = makeFakeContext();
        scheduleDrumVoice(rec.ctx, DEST, 'conga-high', 0, 100);
        const freqCalls = findFreqCalls(rec, 0);
        const set = freqCalls.find((c) => c.method === 'setValueAtTime');
        const ramp = freqCalls.find((c) => c.method === 'exponentialRampToValueAtTime');
        expect(set!.value).toBe(630);
        expect(ramp!.value).toBe(420);
    });
});

describe('scheduleDrumVoice — velocity scaling', () => {
    it('kick gain at velocity 127 is vel * 1.2 = 1.2', () => {
        const rec = makeFakeContext();
        scheduleDrumVoice(rec.ctx, DEST, 'kick', 0, 127);
        const gainCalls = findGainCalls(rec, 0);
        const set = gainCalls.find((c) => c.method === 'setValueAtTime');
        expect(set!.value).toBeCloseTo(1.2, 5);
    });

    it('kick gain at velocity 64 is vel * 1.2 ≈ 0.605', () => {
        const rec = makeFakeContext();
        scheduleDrumVoice(rec.ctx, DEST, 'kick', 0, 64);
        const gainCalls = findGainCalls(rec, 0);
        const set = gainCalls.find((c) => c.method === 'setValueAtTime');
        expect(set!.value).toBeCloseTo((64 / 127) * 1.2, 5);
    });

    it('snare body gain at velocity 100 is vel * 0.7 ≈ 0.551', () => {
        const rec = makeFakeContext();
        scheduleDrumVoice(rec.ctx, DEST, 'snare', 0, 100);
        // snare creates two gain nodes: body (index 0) and noise (index 1).
        const set = rec.gains[0]!.gain.calls.find((c) => c.method === 'setValueAtTime');
        expect(set!.value).toBeCloseTo((100 / 127) * 0.7, 5);
    });
});

describe('scheduleDrumVoice — oscillator types', () => {
    it('kick uses a sine oscillator', () => {
        const rec = makeFakeContext();
        scheduleDrumVoice(rec.ctx, DEST, 'kick', 0, 100);
        expect(rec.oscillators[0]!.type).toBe('sine');
    });

    it('clave uses a triangle oscillator at 2500 Hz', () => {
        const rec = makeFakeContext();
        scheduleDrumVoice(rec.ctx, DEST, 'clave', 0, 100);
        expect(rec.oscillators[0]!.type).toBe('triangle');
        expect(rec.oscillators[0]!.frequency.value).toBe(2500);
    });

    it('cowbell creates two square oscillators at 560 and 845 Hz', () => {
        const rec = makeFakeContext();
        scheduleDrumVoice(rec.ctx, DEST, 'cowbell', 0, 100);
        expect(rec.oscillators.length).toBe(2);
        expect(rec.oscillators.every((osc) => osc.type === 'square')).toBe(true);
        expect(rec.oscillators[0]!.frequency.value).toBe(560);
        expect(rec.oscillators[1]!.frequency.value).toBe(845);
    });

    it('closed hi-hat creates six square oscillators (metallic stack)', () => {
        const rec = makeFakeContext();
        scheduleDrumVoice(rec.ctx, DEST, 'closed-hh', 0, 100);
        expect(rec.oscillators.length).toBe(6);
        expect(rec.oscillators.every((osc) => osc.type === 'square')).toBe(true);
    });
});

describe('scheduleDrumVoice — kick pitch sweep', () => {
    it('sweeps from 150 Hz through 50 Hz to 30 Hz', () => {
        const rec = makeFakeContext();
        scheduleDrumVoice(rec.ctx, DEST, 'kick', 0, 100);
        const freqCalls = findFreqCalls(rec, 0);
        const set = freqCalls.find((c) => c.method === 'setValueAtTime');
        const ramps = freqCalls.filter((c) => c.method === 'exponentialRampToValueAtTime');
        expect(set!.value).toBe(150);
        expect(ramps[0]!.value).toBe(50);
        expect(ramps[1]!.value).toBe(30);
        expect(ramps[0]!.time).toBeCloseTo(0.04, 2);
        expect(ramps[1]!.time).toBeCloseTo(0.5, 2);
    });
});

describe('scheduleDrumVoice — kick WaveShaper curve', () => {
    it('creates a 256-sample distortion curve with 2x oversampling', () => {
        const rec = makeFakeContext();
        scheduleDrumVoice(rec.ctx, DEST, 'kick', 0, 100);
        expect(rec.shapers.length).toBe(1);
        expect(rec.shapers[0]!.curve!.length).toBe(256);
        expect(rec.shapers[0]!.oversample).toBe('2x');
    });
});

describe('scheduleDrumVoice — unknown voice type is a no-op', () => {
    it('does not create any nodes for an unrecognized voice type', () => {
        const rec = makeFakeContext();
        // The switch has no default case; an unknown type falls through silently.
        scheduleDrumVoice(rec.ctx, DEST, 'nonexistent' as never, 0, 100);
        expect(rec.oscillators.length).toBe(0);
        expect(rec.bufferSources.length).toBe(0);
        expect(rec.gains.length).toBe(0);
        expect(rec.filters.length).toBe(0);
    });
});
