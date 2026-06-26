import { describe, it, expect } from 'vitest';

import { type DrumVoiceType } from '../../models/DrumSynthTypes';
import { scheduleDrumVoice } from '../drumSynthVoices';

// --- Minimal fake Web Audio graph ---------------------------------------
// jsdom has no Web Audio APIs. Each created node records whether it is still
// connected; the last-source `onended` handler should disconnect every node in
// the voice graph. A test fires the recorded `onended` callbacks and asserts
// that no node is left connected — the teardown discipline mirrored from
// builtinSynth.ts.

type FakeNode = {
    connected: boolean;
    disconnect: () => void;
    connect: (dest: unknown) => unknown;
};

type FakeSource = FakeNode & {
    start: (time: number) => void;
    stop: (time: number) => void;
    onended: null | (() => void);
};

type FakeContext = {
    ctx: BaseAudioContext;
    /** Every node created in this graph (sources, gains, filters, shapers). */
    nodes: FakeNode[];
    /** Just the scheduled sources, which carry the `onended` teardown hook. */
    sources: FakeSource[];
};

function makeParam() {
    return {
        value: 0,
        setValueAtTime: () => {},
        linearRampToValueAtTime: () => {},
        exponentialRampToValueAtTime: () => {},
    };
}

function makeFakeContext(sampleRate = 48000): FakeContext {
    const nodes: FakeNode[] = [];
    const sources: FakeSource[] = [];

    // Each factory returns the SAME object it registers, so when the engine sets
    // `onended` or calls `disconnect()` it mutates the tracked node — never a copy.
    function makeNode(): FakeNode {
        const node: FakeNode = {
            connected: true,
            disconnect: () => {
                node.connected = false;
            },
            connect: (dest: unknown) => dest,
        };
        nodes.push(node);
        return node;
    }

    function makeSource(): FakeSource {
        const source = makeNode() as FakeSource;
        source.start = () => {};
        source.stop = () => {};
        source.onended = null;
        sources.push(source);
        return source;
    }

    function makeOscillator() {
        return Object.assign(makeSource(), { type: 'sine', frequency: makeParam(), detune: makeParam() });
    }

    function makeBufferSource() {
        return Object.assign(makeSource(), { buffer: null });
    }

    function makeGain() {
        return Object.assign(makeNode(), { gain: makeParam() });
    }

    function makeFilter() {
        return Object.assign(makeNode(), { type: 'lowpass', frequency: makeParam(), Q: makeParam() });
    }

    function makeShaper() {
        return Object.assign(makeNode(), { curve: null, oversample: 'none' });
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

    return { ctx, nodes, sources };
}

const ALL_VOICES: DrumVoiceType[] = [
    'kick',
    'snare',
    'clap',
    'closed-hh',
    'open-hh',
    'tom-low',
    'tom-mid',
    'tom-high',
    'cowbell',
    'rimshot',
    'conga-low',
    'conga-mid',
    'conga-high',
    'maracas',
    'clave',
];

describe('drumSynthVoices — node teardown on source end', () => {
    it.each(ALL_VOICES)('disconnects every node of the %s voice once its sources end', (voice) => {
        const { ctx, nodes, sources } = makeFakeContext();
        const destination = { connect: () => {}, disconnect: () => {} } as unknown as AudioNode;

        scheduleDrumVoice(ctx, destination, voice, 0, 100);

        // Before the sources end, the graph is connected and at least one source
        // carries a teardown handler.
        expect(nodes.length).toBeGreaterThan(0);
        const sourcesWithTeardown = sources.filter((source) => source.onended !== null);
        expect(sourcesWithTeardown.length).toBeGreaterThan(0);

        // Fire every source's onended (the engine schedules them via osc.stop()).
        for (const source of sources) {
            source.onended?.();
        }

        // Every node created for this voice must be disconnected — none may leak.
        const stillConnected = nodes.filter((node) => node.connected);
        expect(stillConnected).toEqual([]);
    });
});
