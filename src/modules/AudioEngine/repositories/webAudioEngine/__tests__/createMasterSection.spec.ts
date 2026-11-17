import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createMasterSection } from '../createMasterSection';

/**
 * A context whose nodes carry a name and record every connect and disconnect
 * into one shared log, so a case can read the order the section wired or tore
 * down its graph in.
 */
type RecordedNode = {
    name: string;
    gain: { value: number; setTargetAtTime: ReturnType<typeof vi.fn> };
    fftSize: number;
    smoothingTimeConstant: number;
    connect(target: RecordedNode, output?: number): void;
    disconnect(): void;
};

function createRecordingContext() {
    const log: string[] = [];
    const counts = new Map<string, number>();

    function createNode(kind: string): RecordedNode {
        const index = counts.get(kind) ?? 0;
        counts.set(kind, index + 1);
        const node: RecordedNode = {
            name: `${kind}${index}`,
            gain: { value: 1, setTargetAtTime: vi.fn() },
            fftSize: 2048,
            smoothingTimeConstant: 0,
            connect: (target, output) => {
                log.push(`${node.name}->${target.name}${output === undefined ? '' : `:${output}`}`);
            },
            disconnect: () => {
                log.push(`${node.name} x`);
            },
        };
        return node;
    }

    const context = {
        currentTime: 3,
        destination: createNode('destination'),
        createGain: () => createNode('gain'),
        createAnalyser: () => createNode('analyser'),
        createChannelSplitter: () => createNode('splitter'),
    };
    return { log, context: context as unknown as AudioContext };
}

/** Records the meter the section builds so a case can drive and inspect it. */
class RecordingWorkletNode {
    static instances: RecordingWorkletNode[] = [];
    name = `meter${RecordingWorkletNode.instances.length}`;
    port = { postMessage: vi.fn() };
    connect = vi.fn();
    disconnect = vi.fn();

    constructor() {
        RecordingWorkletNode.instances.push(this);
    }
}

describe('createMasterSection', () => {
    beforeEach(() => {
        RecordingWorkletNode.instances = [];
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('wires the live programme, listening insert and stereo tap in construction order', () => {
        const { log, context } = createRecordingContext();

        const section = createMasterSection({ context, mode: 'live' });

        // gain0 master, gain1 mono, gain2 dim, gain3 preview gate, gain4 tap sink;
        // analyser0 master, analyser1/2 left/right.
        expect(log).toEqual([
            'gain0->analyser0',
            'analyser0->gain3',
            'gain3->gain1',
            'gain1->gain2',
            'gain2->destination0',
            'analyser0->splitter0',
            'splitter0->analyser1:0',
            'splitter0->analyser2:1',
            'analyser1->gain4',
            'analyser2->gain4',
            'gain4->destination0',
        ]);
        expect(section.gainNode.gain.value).toBe(0.8);
        expect(section.analyser.fftSize).toBe(256);
        expect(section.analyser.smoothingTimeConstant).toBe(0.8);
        expect(section.analyserLeft.fftSize).toBe(256);
        expect(section.analyserRight.fftSize).toBe(256);
        expect(section.stereoTapSink.gain.value).toBe(0);
        expect(section.meterNode()).toBeUndefined();
        expect(section.readPeak()).toBeNull();
    });

    it('builds the fallback graph silent and unwired, with an inert meter and no peak', () => {
        const { log, context } = createRecordingContext();

        const section = createMasterSection({ context, mode: 'fallback' });

        expect(log).toEqual([]);
        expect(section.gainNode.gain.value).toBe(0);
        const meter = section.meterNode();
        expect(meter).toBeDefined();
        expect(meter).not.toBeInstanceOf(AudioWorkletNode);
        expect(section.readPeak()).toBeNull();
    });

    it('replaces a previously wired meter instead of stacking a second tap', () => {
        vi.stubGlobal('AudioWorkletNode', RecordingWorkletNode);
        const { context } = createRecordingContext();
        const section = createMasterSection({ context, mode: 'live' });

        section.wireMeter();
        section.wireMeter();

        const [first, second] = RecordingWorkletNode.instances;
        expect(first?.disconnect).toHaveBeenCalledTimes(1);
        expect(second?.disconnect).not.toHaveBeenCalled();
        expect(section.meterNode()).toBe(second);
    });

    it('tears the master graph down one node per effect in a fixed order and clears the meter', () => {
        vi.stubGlobal('AudioWorkletNode', RecordingWorkletNode);
        const { log, context } = createRecordingContext();
        const section = createMasterSection({ context, mode: 'live' });
        section.wireMeter();
        const meter = RecordingWorkletNode.instances[0]!;
        meter.disconnect.mockImplementation(() => log.push('meter0 x'));
        log.length = 0;

        const effects = section.disposeEffects();
        for (const effect of effects) {
            effect();
        }

        expect(effects).toHaveLength(10);
        expect(log).toEqual([
            'gain0 x',
            'meter0 x',
            'analyser0 x',
            'gain3 x',
            'gain1 x',
            'gain2 x',
            'splitter0 x',
            'analyser1 x',
            'analyser2 x',
            'gain4 x',
        ]);
        expect(section.meterNode()).toBeUndefined();
        expect(section.readPeak()).toBeNull();
    });

    it('posts shutdown only to a wired worklet meter', () => {
        vi.stubGlobal('AudioWorkletNode', RecordingWorkletNode);
        const { context } = createRecordingContext();
        const section = createMasterSection({ context, mode: 'live' });
        section.wireMeter();
        const meter = RecordingWorkletNode.instances[0]!;
        meter.port.postMessage.mockClear();

        section.postShutdown({ type: 'shutdown' });

        expect(meter.port.postMessage).toHaveBeenCalledExactlyOnceWith({ type: 'shutdown' });
    });
});
