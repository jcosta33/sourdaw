import { afterEach, describe, expect, it, vi } from 'vitest';

import { createNoiseBurst } from '../createNoiseBurst';

type FakeConnection = {
    from: string;
    to: string;
};

type FakeConnectable = {
    label: string;
    connect(target: FakeConnectable): FakeConnectable;
};

type FakeParamSetCall = {
    value: number;
    time: number;
};

type FakeParamRampCall = {
    value: number;
    time: number;
};

function createFakeParam() {
    const set_value_calls: FakeParamSetCall[] = [];
    const ramp_calls: FakeParamRampCall[] = [];

    return {
        value: 0,
        set_value_calls,
        ramp_calls,
        setValueAtTime(value: number, time: number): void {
            set_value_calls.push({ value, time });
            this.value = value;
        },
        exponentialRampToValueAtTime(value: number, time: number): void {
            ramp_calls.push({ value, time });
            this.value = value;
        },
    };
}

class FakeBuffer {
    readonly data: Float32Array;

    constructor(
        readonly numberOfChannels: number,
        readonly length: number,
        readonly sampleRate: number
    ) {
        this.data = new Float32Array(length);
    }

    getChannelData(channel: number): Float32Array {
        if (channel !== 0) {
            throw new Error(`Unexpected channel ${channel}`);
        }

        return this.data;
    }
}

class FakeBufferSource implements FakeConnectable {
    buffer: FakeBuffer | null = null;
    readonly start_times: number[] = [];
    readonly stop_times: number[] = [];

    constructor(
        readonly label: string,
        private readonly connections: FakeConnection[]
    ) {}

    connect(target: FakeConnectable): FakeConnectable {
        this.connections.push({ from: this.label, to: target.label });
        return target;
    }

    start(time: number): void {
        this.start_times.push(time);
    }

    stop(time: number): void {
        this.stop_times.push(time);
    }
}

class FakeGain implements FakeConnectable {
    readonly gain = createFakeParam();

    constructor(
        readonly label: string,
        private readonly connections: FakeConnection[]
    ) {}

    connect(target: FakeConnectable): FakeConnectable {
        this.connections.push({ from: this.label, to: target.label });
        return target;
    }
}

class FakeFilter implements FakeConnectable {
    type: BiquadFilterType = 'lowpass';
    readonly frequency = { value: 0 };

    constructor(
        readonly label: string,
        private readonly connections: FakeConnection[]
    ) {}

    connect(target: FakeConnectable): FakeConnectable {
        this.connections.push({ from: this.label, to: target.label });
        return target;
    }
}

class FakeDestination implements FakeConnectable {
    readonly label = 'destination';

    constructor(private readonly connections: FakeConnection[]) {}

    connect(target: FakeConnectable): FakeConnectable {
        this.connections.push({ from: this.label, to: target.label });
        return target;
    }
}

type FakeContext = {
    connections: FakeConnection[];
    destination: FakeDestination;
    buffer_sources: FakeBufferSource[];
    buffers: FakeBuffer[];
    filters: FakeFilter[];
    gains: FakeGain[];
    createBufferSource(): FakeBufferSource;
    createBuffer(numberOfChannels: number, length: number, sampleRate: number): FakeBuffer;
    createGain(): FakeGain;
    createBiquadFilter(): FakeFilter;
};

function createFakeContext(): FakeContext {
    const connections: FakeConnection[] = [];
    const buffer_sources: FakeBufferSource[] = [];
    const buffers: FakeBuffer[] = [];
    const filters: FakeFilter[] = [];
    const gains: FakeGain[] = [];

    const context = {
        connections,
        destination: new FakeDestination(connections),
        buffer_sources,
        buffers,
        filters,
        gains,
        createBufferSource(): FakeBufferSource {
            const source = new FakeBufferSource(`source-${buffer_sources.length + 1}`, connections);
            buffer_sources.push(source);
            return source;
        },
        createBuffer(numberOfChannels: number, length: number, sampleRate: number): FakeBuffer {
            const buffer = new FakeBuffer(numberOfChannels, length, sampleRate);
            buffers.push(buffer);
            return buffer;
        },
        createGain(): FakeGain {
            const gain = new FakeGain(`gain-${gains.length + 1}`, connections);
            gains.push(gain);
            return gain;
        },
        createBiquadFilter(): FakeFilter {
            const filter = new FakeFilter(`filter-${filters.length + 1}`, connections);
            filters.push(filter);
            return filter;
        },
    };

    return context;
}

describe('createNoiseBurst', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('should create a one-channel noise buffer at 44.1 kHz from Math.random samples', () => {
        const context = createFakeContext();
        vi.spyOn(Math, 'random').mockReturnValueOnce(0).mockReturnValueOnce(0.25).mockReturnValueOnce(1);

        createNoiseBurst({
            ctx: context,
            time: 1.5,
            duration: 3 / 44_100,
            vol: 0.4,
            filterType: 'bandpass',
            freq: 1200,
        });

        expect(context.buffers).toHaveLength(1);
        const buffer = context.buffers[0];
        if (!buffer) {
            throw new Error('expected a created noise buffer');
        }
        expect(buffer.numberOfChannels).toBe(1);
        expect(buffer.length).toBe(3);
        expect(buffer.sampleRate).toBe(44_100);
        expect([...buffer.data]).toEqual([-1, -0.5, 1]);
    });

    it('should route noise through filter and gain envelope with scheduled start and stop', () => {
        const context = createFakeContext();
        vi.spyOn(Math, 'random').mockReturnValue(0.5);

        createNoiseBurst({
            ctx: context,
            time: 0.25,
            duration: 0.15,
            vol: 0.6,
            filterType: 'highpass',
            freq: 2000,
        });

        expect(context.connections).toEqual([
            { from: 'source-1', to: 'filter-1' },
            { from: 'filter-1', to: 'gain-1' },
            { from: 'gain-1', to: 'destination' },
        ]);
        const filter = context.filters[0];
        const gain = context.gains[0];
        const source = context.buffer_sources[0];
        if (!filter || !gain || !source) {
            throw new Error('expected a filter, gain, and buffer source to be created');
        }
        expect(filter.type).toBe('highpass');
        expect(filter.frequency.value).toBe(2000);
        expect(gain.gain.set_value_calls).toEqual([{ value: 0.6, time: 0.25 }]);
        expect(gain.gain.ramp_calls).toEqual([{ value: 0.001, time: 0.4 }]);
        expect(source.start_times).toEqual([0.25]);
        expect(source.stop_times).toEqual([0.5]);
    });
});
