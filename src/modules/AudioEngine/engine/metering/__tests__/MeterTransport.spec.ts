import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MeterTransport } from '../MeterTransport';

type MeterMessage = { type: 'init'; sab: SharedArrayBuffer } | { type: 'shutdown' };

class FakeWorkletNode {
    public static instances: FakeWorkletNode[] = [];

    public readonly port = {
        close: vi.fn(),
        postMessage: vi.fn<(message: MeterMessage) => void>(),
    };

    constructor(
        public readonly context: AudioContext,
        public readonly name: string,
        public readonly options: AudioWorkletNodeOptions
    ) {
        FakeWorkletNode.instances.push(this);
    }
}

function makeSource(): AudioNode {
    return {
        connect: vi.fn(),
        disconnect: vi.fn(),
    } as unknown as AudioNode;
}

function initView(node: FakeWorkletNode): Float32Array {
    const message = node.port.postMessage.mock.calls[0]?.[0];
    if (!message || message.type !== 'init') {
        throw new Error('Meter pool was not initialized.');
    }
    return new Float32Array(message.sab);
}

describe('MeterTransport', () => {
    beforeEach(() => {
        FakeWorkletNode.instances = [];
        vi.stubGlobal('AudioWorkletNode', FakeWorkletNode);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('pools 32 independent side taps per zero-output worklet', () => {
        const transport = new MeterTransport({} as AudioContext);
        const sources = Array.from({ length: 33 }, () => makeSource());
        for (const [index, source] of sources.entries()) {
            transport.register(`meter-${String(index)}`, source);
        }

        transport.start();

        expect(FakeWorkletNode.instances).toHaveLength(2);
        expect(FakeWorkletNode.instances[0]?.options).toMatchObject({
            numberOfInputs: 32,
            numberOfOutputs: 0,
        });
        expect(sources[0]?.connect).toHaveBeenCalledWith(FakeWorkletNode.instances[0], 0, 0);
        expect(sources[31]?.connect).toHaveBeenCalledWith(FakeWorkletNode.instances[0], 0, 31);
        expect(sources[32]?.connect).toHaveBeenCalledWith(FakeWorkletNode.instances[1], 0, 0);
        expect(transport.getTapCount()).toBe(33);
        expect(transport.getWorkletCount()).toBe(2);
    });

    it('returns and resets only the requested pooled peak slot', () => {
        const transport = new MeterTransport({} as AudioContext);
        transport.register('first', makeSource());
        transport.register('second', makeSource());
        transport.start();
        const peaks = initView(FakeWorkletNode.instances[0]!);
        peaks[0] = 0.75;
        peaks[1] = 0.4;

        expect(transport.read('first')).toBeCloseTo(0.75, 5);
        expect(transport.read('first')).toBe(0);
        expect(transport.read('second')).toBeCloseTo(0.4, 5);
    });

    it('reconnects a side tap after its host strip rebuilds the audible graph', () => {
        const transport = new MeterTransport({} as AudioContext);
        const source = makeSource();
        transport.register('track', source);
        transport.start();
        vi.mocked(source.connect).mockClear();

        transport.reconnect('track');

        expect(source.connect).toHaveBeenCalledWith(FakeWorkletNode.instances[0], 0, 0);
    });

    it('shuts down and releases an empty pool', () => {
        const transport = new MeterTransport({} as AudioContext);
        const source = makeSource();
        transport.register('track', source);
        transport.start();
        const node = FakeWorkletNode.instances[0]!;

        transport.unregister('track');

        expect(source.disconnect).toHaveBeenCalledWith(node, 0, 0);
        expect(node.port.postMessage).toHaveBeenLastCalledWith({ type: 'shutdown' });
        expect(node.port.close).toHaveBeenCalledTimes(1);
        expect(transport.getTapCount()).toBe(0);
        expect(transport.getWorkletCount()).toBe(0);
    });

    it('rolls back a partial start so initialization can retry cleanly', () => {
        const transport = new MeterTransport({} as AudioContext);
        const first = makeSource();
        const second = makeSource();
        vi.mocked(second.connect).mockImplementationOnce(() => {
            throw new Error('connection failed');
        });
        transport.register('first', first);
        transport.register('second', second);

        expect(() => transport.start()).toThrow('connection failed');
        expect(first.disconnect).toHaveBeenCalledWith(FakeWorkletNode.instances[0], 0, 0);
        expect(transport.getTapCount()).toBe(0);
        expect(transport.getWorkletCount()).toBe(0);

        transport.start();
        expect(transport.getTapCount()).toBe(2);
        expect(transport.getWorkletCount()).toBe(1);
    });

    it('finishes ownership cleanup when the exact audio edge is already absent', () => {
        const transport = new MeterTransport({} as AudioContext);
        const source = makeSource();
        vi.mocked(source.disconnect).mockImplementation(() => {
            throw new DOMException('edge absent', 'InvalidAccessError');
        });
        transport.register('track', source);
        transport.start();

        expect(() => transport.unregister('track')).not.toThrow();
        expect(transport.getTapCount()).toBe(0);
        expect(transport.getWorkletCount()).toBe(0);
    });
});
