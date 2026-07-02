import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { generateDemoDrumBuffer } from '../generateDemoDrumBuffer';

const mocks = vi.hoisted(() => ({
    audioBufferCacheSet: vi.fn(),
}));

vi.mock('#/modules/AudioEngine/stores', () => ({
    audioBufferCache: {
        set: mocks.audioBufferCacheSet,
    },
}));

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

const created_contexts: FakeOfflineAudioContext[] = [];

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

class FakeOscillator implements FakeConnectable {
    type: OscillatorType = 'sine';
    readonly frequency = createFakeParam();
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

class FakeDestination implements FakeConnectable {
    readonly label = 'destination';

    constructor(private readonly connections: FakeConnection[]) {}

    connect(target: FakeConnectable): FakeConnectable {
        this.connections.push({ from: this.label, to: target.label });
        return target;
    }
}

class FakeOfflineAudioContext {
    readonly connections: FakeConnection[] = [];
    readonly destination = new FakeDestination(this.connections);
    readonly buffer_sources: FakeBufferSource[] = [];
    readonly buffers: FakeBuffer[] = [];
    readonly filters: FakeFilter[] = [];
    readonly gains: FakeGain[] = [];
    readonly oscillators: FakeOscillator[] = [];
    readonly rendered_buffer = { id: 'rendered-buffer' };
    start_render_count = 0;

    constructor(
        readonly numberOfChannels: number,
        readonly length: number,
        readonly sampleRate: number
    ) {
        created_contexts.push(this);
    }

    createBufferSource(): FakeBufferSource {
        const source = new FakeBufferSource(`source-${this.buffer_sources.length + 1}`, this.connections);
        this.buffer_sources.push(source);
        return source;
    }

    createBuffer(numberOfChannels: number, length: number, sampleRate: number): FakeBuffer {
        const buffer = new FakeBuffer(numberOfChannels, length, sampleRate);
        this.buffers.push(buffer);
        return buffer;
    }

    createGain(): FakeGain {
        const gain = new FakeGain(`gain-${this.gains.length + 1}`, this.connections);
        this.gains.push(gain);
        return gain;
    }

    createBiquadFilter(): FakeFilter {
        const filter = new FakeFilter(`filter-${this.filters.length + 1}`, this.connections);
        this.filters.push(filter);
        return filter;
    }

    createOscillator(): FakeOscillator {
        const oscillator = new FakeOscillator(`oscillator-${this.oscillators.length + 1}`, this.connections);
        this.oscillators.push(oscillator);
        return oscillator;
    }

    startRendering(): Promise<{ id: string }> {
        this.start_render_count += 1;
        return Promise.resolve(this.rendered_buffer);
    }
}

describe('generateDemoDrumBuffer', () => {
    beforeEach(() => {
        created_contexts.length = 0;
        mocks.audioBufferCacheSet.mockReset();
        vi.stubGlobal('OfflineAudioContext', FakeOfflineAudioContext);
        vi.spyOn(Math, 'random').mockReturnValue(0.5);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('should render the requested duration and cache the generated buffer', async () => {
        await generateDemoDrumBuffer('demo-drum-buffer', 4, 120, 'kick');

        expect(created_contexts).toHaveLength(1);
        const context = created_contexts[0];
        expect(context.numberOfChannels).toBe(2);
        expect(context.length).toBe(88_200);
        expect(context.sampleRate).toBe(44_100);
        expect(context.start_render_count).toBe(1);
        expect(mocks.audioBufferCacheSet).toHaveBeenCalledExactlyOnceWith('demo-drum-buffer', context.rendered_buffer);
    });

    it('should schedule representative electro oscillator and noise branches', async () => {
        await generateDemoDrumBuffer('electro-drum-buffer', 4, 120, 'electro');

        const context = created_contexts[0];
        expect(context.buffer_sources.map((source) => source.start_times)).toEqual([[0.5], [1.5]]);
        expect(context.filters.map((filter) => filter.type)).toEqual(['highpass', 'highpass']);
        expect(context.filters.map((filter) => filter.frequency.value)).toEqual([2000, 2000]);

        expect(context.oscillators).toHaveLength(4);
        expect(context.oscillators[0].frequency.set_value_calls).toEqual([{ value: 120, time: 0 }]);
        expect(context.oscillators[0].frequency.ramp_calls).toEqual([{ value: 30, time: 0.1 }]);
        expect(context.oscillators[0].start_times).toEqual([0]);
        expect(context.oscillators[0].stop_times).toEqual([0.3]);

        expect(context.oscillators[1].type).toBe('triangle');
        expect(context.oscillators[1].frequency.value).toBe(200);
        expect(context.oscillators[1].start_times).toEqual([0.5]);
        expect(context.oscillators[1].stop_times).toEqual([0.6]);
    });
});
