/**
 * A deterministic, *sample-producing* model of Web Audio, built so two
 * production graph-construction paths can be rendered and subtracted.
 *
 * ── What this is for ──────────────────────────────────────────────────────
 *
 * The question `liveOfflineNullTest.spec.ts` asks is "does an export sound like
 * the session?". Answering it needs samples out of both runtimes, and nothing
 * in the suite could produce them: jsdom has no Web Audio, and `setupTests.ts`
 * supplies only enough of one for `instanceof` checks and node construction.
 * Every existing live/offline parity spec therefore asserts a *call shape* —
 * `toasterLiveOfflineParity.spec.ts` stubs `getTrackStrip` outright, so the live
 * side is never built at all — and a projection that is wrong but
 * self-consistent passes all of them.
 *
 * `src/helpers/__tests__/offlineWorkletRenderHarness.ts` renders, and is the
 * right instrument for the question it was built for ("did the transport
 * deliver any energy at all?"). It cannot answer this one, by its own
 * declaration: its `AudioParam`s are `vi.fn()` no-ops, its delay lines do not
 * delay, its oscillators are silent and it has no filter, waveshaper or
 * analyser. A null test run on it would report a clean null for a fixture whose
 * filter cutoff differed by an octave, because neither side would filter. An
 * instrument that cannot see the parameter under test is worse than none.
 *
 * ── What it models, and what that buys ────────────────────────────────────
 *
 * Every node whose *output depends on a parameter the two paths might set
 * differently* is implemented for real:
 *
 *   - `GainNode`               multiplies.
 *   - `StereoPannerNode`       the spec's stereo equal-power law (§1.14.1).
 *   - `BiquadFilterNode`       the spec's transfer functions (§1.7.1), running
 *                              direct-form-1 with per-node state across quanta.
 *   - `WaveShaperNode`         the spec's curve lookup with linear interpolation.
 *   - `AnalyserNode`           pass-through, which is what it is.
 *   - `AudioWorkletNode`       runs the real registered processor's `process()`.
 *
 * A node type nothing here models throws on construction rather than degrading
 * to a pass-through. That is deliberate: a silently-inert node turns this from a
 * null test into a shape test, which is the defect the whole file exists to stop
 * repeating. Adding a fixture device that needs a compressor or a delay line
 * means implementing it here first.
 *
 * ── What it is not ────────────────────────────────────────────────────────
 *
 * It is a model, not Chromium. `oversample` is ignored, block-rate is used where
 * the spec says a-rate, and no absolute output of this harness should be
 * compared against a browser's. That costs nothing for the measurement being
 * made, because **both legs run through the same model**: what is measured is
 * the difference between two production construction paths, and the model
 * cancels out of the subtraction. A residual it reports is a real divergence in
 * `src/`. A null it reports is proof that the two paths configure the graph
 * identically — not proof that an un-modelled browser behaviour also agrees.
 *
 * ── Automation is settled, not glided ─────────────────────────────────────
 *
 * `AudioParam` records writes and reports the value the last write targets.
 * `startRendering()` settles every param before the first quantum.
 *
 * This is the difference between comparing the product and comparing the test
 * setup. Live writes the fader with `setTargetAtTime(v, now, 0.01)` and offline
 * assigns `.value` outright, so a harness that glided would show a ~100 ms
 * exponential residual at the head of every render — an artefact of choosing to
 * press play at t=0, not of anything the product does. A user's export is
 * compared against playback with the mixer *at rest*, and that is the state
 * modelled here. It costs no sensitivity to the thing under test: settling
 * collapses to the value live actually wrote, so a live target that differs from
 * the offline assignment still reds. Automation *during* a render is a different
 * property with its own specs (`automationScheduling`, `offlineVcaGainParity`).
 */

import { vi } from 'vitest';

/** The Web Audio render quantum. */
const QUANTUM_FRAMES = 128;

type ScheduledWrite = { time: number; target: number };

/**
 * Records what was written and reports where the graph comes to rest. See the
 * automation note in the module header for why rest, and not the glide, is the
 * state this harness renders.
 */
class HarnessAudioParam {
    private readonly writes: ScheduledWrite[] = [];
    private settled = false;

    constructor(public value: number) {}

    setValueAtTime(target: number, time: number): void {
        this.record(target, time);
    }
    linearRampToValueAtTime(target: number, time: number): void {
        this.record(target, time);
    }
    exponentialRampToValueAtTime(target: number, time: number): void {
        this.record(target, time);
    }
    setTargetAtTime(target: number, time: number, _timeConstant: number): void {
        this.record(target, time);
    }
    cancelScheduledValues(_time: number): void {
        this.writes.length = 0;
    }
    setValueCurveAtTime(curve: Float32Array, time: number, _duration: number): void {
        const last = curve.at(-1);
        if (last !== undefined) {
            this.record(last, time);
        }
    }

    /** Collapse the recorded writes into `value`. Idempotent. */
    settle(): void {
        if (this.settled) {
            return;
        }
        this.settled = true;
        let latest: ScheduledWrite | null = null;
        for (const write of this.writes) {
            if (!latest || write.time >= latest.time) {
                latest = write;
            }
        }
        if (latest) {
            this.value = latest.target;
        }
    }

    private record(target: number, time: number): void {
        this.writes.push({ time, target });
    }
}

type StereoBlock = { left: Float32Array; right: Float32Array };

class HarnessAudioNode {
    numberOfInputs = 1;
    numberOfOutputs = 1;
    /** Upstream edges, in connect order. */
    readonly inputs: HarnessAudioNode[] = [];
    /** Downstream edges. Kept in step with `inputs` so `disconnect` is real. */
    readonly outputs: HarnessAudioNode[] = [];
    protected readonly out: StereoBlock = {
        left: new Float32Array(QUANTUM_FRAMES),
        right: new Float32Array(QUANTUM_FRAMES),
    };
    private renderedQuantum = -1;

    connect(destination: unknown): unknown {
        if (destination instanceof HarnessAudioNode) {
            destination.inputs.push(this);
            this.outputs.push(destination);
        }
        return destination;
    }

    /**
     * Real edge removal, not a no-op. `TrackNode.rebuildChain` tears the whole
     * strip down and rewires it on every device change; a harness that ignored
     * `disconnect()` would leave the pre-rebuild edges in place and render each
     * strip summed with a stale copy of itself.
     */
    disconnect(destination?: unknown): void {
        const targets = destination instanceof HarnessAudioNode ? [destination] : [...this.outputs];
        for (const target of targets) {
            removeFirst(target.inputs, this);
            removeFirst(this.outputs, target);
        }
    }

    render(quantum: number): StereoBlock {
        if (this.renderedQuantum === quantum) {
            return this.out;
        }
        // Marked before recursing so a fan-out is summed once per quantum and a
        // feedback edge yields last quantum's block instead of spinning the stack.
        this.renderedQuantum = quantum;
        this.out.left.fill(0);
        this.out.right.fill(0);
        for (const source of this.inputs) {
            const block = source.render(quantum);
            for (let index = 0; index < QUANTUM_FRAMES; index++) {
                this.out.left[index] = this.out.left[index]! + block.left[index]!;
                this.out.right[index] = this.out.right[index]! + block.right[index]!;
            }
        }
        this.transform();
        return this.out;
    }

    protected transform(): void {}
}

function removeFirst(list: HarnessAudioNode[], entry: HarnessAudioNode): void {
    const index = list.indexOf(entry);
    if (index >= 0) {
        list.splice(index, 1);
    }
}

class HarnessGainNode extends HarnessAudioNode {
    constructor(readonly gain: HarnessAudioParam) {
        super();
    }

    protected override transform(): void {
        const level = this.gain.value;
        if (level === 1) {
            return;
        }
        for (let index = 0; index < QUANTUM_FRAMES; index++) {
            this.out.left[index] = this.out.left[index]! * level;
            this.out.right[index] = this.out.right[index]! * level;
        }
    }
}

/** Web Audio §1.14.1, the stereo-input branch. */
class HarnessStereoPannerNode extends HarnessAudioNode {
    constructor(readonly pan: HarnessAudioParam) {
        super();
    }

    protected override transform(): void {
        const position = Math.max(-1, Math.min(1, this.pan.value));
        const x = position <= 0 ? position + 1 : position;
        const gainLeft = Math.cos((x * Math.PI) / 2);
        const gainRight = Math.sin((x * Math.PI) / 2);
        for (let index = 0; index < QUANTUM_FRAMES; index++) {
            const left = this.out.left[index]!;
            const right = this.out.right[index]!;
            if (position <= 0) {
                this.out.left[index] = left + right * gainLeft;
                this.out.right[index] = right * gainRight;
            } else {
                this.out.left[index] = left * gainLeft;
                this.out.right[index] = right + left * gainRight;
            }
        }
    }
}

type BiquadCoefficients = { b0: number; b1: number; b2: number; a1: number; a2: number };

/**
 * Web Audio §1.7.1. `Q` is interpreted in dB for lowpass/highpass, as the spec
 * requires, and linearly elsewhere — the two are different numbers and a
 * harness that used one everywhere would be insensitive to `filter-resonance`
 * on exactly the device most likely to carry it.
 */
function biquadCoefficients(input: {
    type: string;
    frequency: number;
    q: number;
    gainDb: number;
    sampleRate: number;
}): BiquadCoefficients {
    const w0 = (2 * Math.PI * input.frequency) / input.sampleRate;
    const cosW0 = Math.cos(w0);
    const sinW0 = Math.sin(w0);
    const alphaQ = sinW0 / (2 * input.q);
    const alphaQdB = sinW0 / (2 * 10 ** (input.q / 20));
    const amplitude = 10 ** (input.gainDb / 40);

    function normalize(b0: number, b1: number, b2: number, a0: number, a1: number, a2: number): BiquadCoefficients {
        return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
    }

    if (input.type === 'lowpass') {
        const b1 = 1 - cosW0;
        return normalize(b1 / 2, b1, b1 / 2, 1 + alphaQdB, -2 * cosW0, 1 - alphaQdB);
    }
    if (input.type === 'highpass') {
        const b1 = -(1 + cosW0);
        return normalize(-b1 / 2, b1, -b1 / 2, 1 + alphaQdB, -2 * cosW0, 1 - alphaQdB);
    }
    if (input.type === 'bandpass') {
        return normalize(alphaQ, 0, -alphaQ, 1 + alphaQ, -2 * cosW0, 1 - alphaQ);
    }
    if (input.type === 'notch') {
        return normalize(1, -2 * cosW0, 1, 1 + alphaQ, -2 * cosW0, 1 - alphaQ);
    }
    if (input.type === 'peaking') {
        return normalize(
            1 + alphaQ * amplitude,
            -2 * cosW0,
            1 - alphaQ * amplitude,
            1 + alphaQ / amplitude,
            -2 * cosW0,
            1 - alphaQ / amplitude
        );
    }
    if (input.type === 'lowshelf' || input.type === 'highshelf') {
        const alphaS = (sinW0 / 2) * Math.SQRT2;
        const twoSqrtAAlpha = 2 * Math.sqrt(amplitude) * alphaS;
        const sign = input.type === 'lowshelf' ? 1 : -1;
        return normalize(
            amplitude * (amplitude + 1 - sign * (amplitude - 1) * cosW0 + twoSqrtAAlpha),
            2 * sign * amplitude * (amplitude - 1 - sign * (amplitude + 1) * cosW0),
            amplitude * (amplitude + 1 - sign * (amplitude - 1) * cosW0 - twoSqrtAAlpha),
            amplitude + 1 + sign * (amplitude - 1) * cosW0 + twoSqrtAAlpha,
            -2 * sign * (amplitude - 1 + sign * (amplitude + 1) * cosW0),
            amplitude + 1 + sign * (amplitude - 1) * cosW0 - twoSqrtAAlpha
        );
    }
    throw new Error(`nullTestRenderHarness models no biquad type "${input.type}"`);
}

class HarnessBiquadFilterNode extends HarnessAudioNode {
    type = 'lowpass';
    private coefficients: BiquadCoefficients | null = null;
    private readonly state = [
        { x1: 0, x2: 0, y1: 0, y2: 0 },
        { x1: 0, x2: 0, y1: 0, y2: 0 },
    ];

    constructor(
        readonly frequency: HarnessAudioParam,
        readonly Q: HarnessAudioParam,
        readonly gain: HarnessAudioParam,
        readonly detune: HarnessAudioParam,
        private readonly sampleRate: number
    ) {
        super();
    }

    protected override transform(): void {
        this.coefficients ??= biquadCoefficients({
            type: this.type,
            frequency: this.frequency.value * 2 ** (this.detune.value / 1200),
            q: this.Q.value,
            gainDb: this.gain.value,
            sampleRate: this.sampleRate,
        });
        const { b0, b1, b2, a1, a2 } = this.coefficients;
        const channels: Array<keyof StereoBlock> = ['left', 'right'];
        for (const [channel, key] of channels.entries()) {
            const data = this.out[key];
            const state = this.state[channel]!;
            for (let index = 0; index < QUANTUM_FRAMES; index++) {
                const x0 = data[index]!;
                const y0 = b0 * x0 + b1 * state.x1 + b2 * state.x2 - a1 * state.y1 - a2 * state.y2;
                state.x2 = state.x1;
                state.x1 = x0;
                state.y2 = state.y1;
                state.y1 = y0;
                data[index] = y0;
            }
        }
    }
}

/** Web Audio §1.13.1. `oversample` is ignored; see the module header. */
class HarnessWaveShaperNode extends HarnessAudioNode {
    curve: Float32Array | null = null;
    oversample = 'none';

    protected override transform(): void {
        const { curve } = this;
        if (!curve || curve.length === 0) {
            return;
        }
        const lastIndex = curve.length - 1;
        const channels: Array<keyof StereoBlock> = ['left', 'right'];
        for (const key of channels) {
            const data = this.out[key];
            for (let index = 0; index < QUANTUM_FRAMES; index++) {
                const clamped = Math.max(-1, Math.min(1, data[index]!));
                const position = ((clamped + 1) / 2) * lastIndex;
                const lower = Math.min(lastIndex, Math.floor(position));
                const upper = Math.min(lastIndex, lower + 1);
                const fraction = position - lower;
                data[index] = curve[lower]! + fraction * (curve[upper]! - curve[lower]!);
            }
        }
    }
}

/** Pass-through, which is all an analyser is in the signal path. */
class HarnessAnalyserNode extends HarnessAudioNode {
    fftSize = 2048;
    smoothingTimeConstant = 0.8;
    get frequencyBinCount(): number {
        return this.fftSize / 2;
    }
    getFloatTimeDomainData(data: Float32Array): void {
        data.fill(0);
    }
    getFloatFrequencyData(data: Float32Array): void {
        data.fill(-Infinity);
    }
}

type HarnessPort = {
    onmessage: ((event: MessageEvent) => void) | null;
    postMessage: (message: unknown) => void;
    close: () => void;
};

type HarnessProcessorLike = {
    process: (inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>) => boolean;
};

function createPortPair(): { outer: HarnessPort; inner: HarnessPort } {
    const outer: HarnessPort = {
        onmessage: null,
        postMessage: (message) => inner.onmessage?.({ data: message } as MessageEvent),
        close: () => {},
    };
    const inner: HarnessPort = {
        onmessage: null,
        postMessage: (message) => outer.onmessage?.({ data: message } as MessageEvent),
        close: () => {},
    };
    return { outer, inner };
}

export type NullTestRenderHarness = {
    /**
     * Install the `AudioWorkletGlobalScope` globals a processor module reads at
     * import time. Call before importing any processor module.
     */
    installWorkletGlobals: (input: { sampleRate: number }) => void;
    /** Stub as the global `OfflineAudioContext`. */
    OfflineAudioContext: new (numberOfChannels: number, length: number, sampleRate: number) => HarnessRenderContext;
    /** Stub as the global `AudioWorkletNode`. */
    AudioWorkletNode: new (context: unknown, processorName: string, options?: AudioWorkletNodeOptions) => unknown;
    registeredProcessorNames: () => string[];
};

export type HarnessRenderContext = {
    destination: HarnessAudioNode;
    sampleRate: number;
    length: number;
    currentTime: number;
    createGain: () => unknown;
    createStereoPanner: () => unknown;
    createBiquadFilter: () => unknown;
    createWaveShaper: () => unknown;
    createAnalyser: () => unknown;
    /** A fixed, pre-computed stereo signal. Not part of Web Audio; see `createSignalSource`. */
    createSignalSource: (samples: { left: Float32Array; right: Float32Array }) => HarnessAudioNode;
    startRendering: () => Promise<RenderedBuffer>;
};

export type RenderedBuffer = {
    sampleRate: number;
    length: number;
    numberOfChannels: number;
    getChannelData: (channel: number) => Float32Array;
};

export function createNullTestRenderHarness(): NullTestRenderHarness {
    const processorRegistry = new Map<string, new () => HarnessProcessorLike>();
    let pendingProcessorPort: HarnessPort | null = null;
    let harnessFrame = 0;

    class AudioWorkletProcessorShim {
        readonly port: HarnessPort;
        constructor() {
            if (!pendingProcessorPort) {
                throw new Error('AudioWorkletProcessor was constructed outside a harness worklet node');
            }
            this.port = pendingProcessorPort;
        }
    }

    class HarnessAudioWorkletNode extends HarnessAudioNode {
        readonly port: HarnessPort;
        readonly parameters = new Map<string, HarnessAudioParam>();
        private readonly processor: HarnessProcessorLike;
        private readonly scratch: StereoBlock = {
            left: new Float32Array(QUANTUM_FRAMES),
            right: new Float32Array(QUANTUM_FRAMES),
        };

        constructor(_context: unknown, processorName: string, options?: AudioWorkletNodeOptions) {
            super();
            this.numberOfInputs = options?.numberOfInputs ?? 1;
            const Processor = processorRegistry.get(processorName);
            if (!Processor) {
                throw new Error(`AudioWorklet processor "${processorName}" is not registered with the harness`);
            }
            const { outer, inner } = createPortPair();
            this.port = outer;
            pendingProcessorPort = inner;
            try {
                this.processor = new Processor();
            } finally {
                pendingProcessorPort = null;
            }
        }

        protected override transform(): void {
            // A real processor reads `inputs` and writes `outputs`; handing it the
            // same arrays for both would let a pass-through look correct while a
            // processor that accumulates silently doubled.
            this.scratch.left.set(this.out.left);
            this.scratch.right.set(this.out.right);
            this.out.left.fill(0);
            this.out.right.fill(0);
            this.processor.process([[this.scratch.left, this.scratch.right]], [[this.out.left, this.out.right]], {});
        }
    }

    class HarnessSignalSourceNode extends HarnessAudioNode {
        override numberOfInputs = 0;
        private frame = 0;

        constructor(private readonly samples: { left: Float32Array; right: Float32Array }) {
            super();
        }

        protected override transform(): void {
            for (let index = 0; index < QUANTUM_FRAMES; index++) {
                const position = this.frame + index;
                this.out.left[index] = this.samples.left[position] ?? 0;
                this.out.right[index] = this.samples.right[position] ?? 0;
            }
            this.frame += QUANTUM_FRAMES;
        }
    }

    class HarnessOfflineAudioContext implements HarnessRenderContext {
        readonly destination = new HarnessAudioNode();
        readonly audioWorklet = { addModule: (): Promise<void> => Promise.resolve() };
        currentTime = 0;
        state = 'suspended';
        private readonly params: HarnessAudioParam[] = [];

        constructor(
            readonly numberOfChannels: number,
            readonly length: number,
            readonly sampleRate: number
        ) {}

        private param(value: number): HarnessAudioParam {
            const param = new HarnessAudioParam(value);
            this.params.push(param);
            return param;
        }

        createGain(): HarnessGainNode {
            return new HarnessGainNode(this.param(1));
        }
        createStereoPanner(): HarnessStereoPannerNode {
            return new HarnessStereoPannerNode(this.param(0));
        }
        createBiquadFilter(): HarnessBiquadFilterNode {
            return new HarnessBiquadFilterNode(
                this.param(350),
                this.param(1),
                this.param(0),
                this.param(0),
                this.sampleRate
            );
        }
        createWaveShaper(): HarnessWaveShaperNode {
            return new HarnessWaveShaperNode();
        }
        createAnalyser(): HarnessAnalyserNode {
            return new HarnessAnalyserNode();
        }
        createSignalSource(samples: { left: Float32Array; right: Float32Array }): HarnessAudioNode {
            return new HarnessSignalSourceNode(samples);
        }

        // Unmodelled constructors throw rather than degrade. See the module header.
        createDelay(): never {
            throw new Error(
                'nullTestRenderHarness models no DelayNode — implement one before fixturing a device that needs it'
            );
        }
        createDynamicsCompressor(): never {
            throw new Error(
                'nullTestRenderHarness models no DynamicsCompressorNode — implement one before fixturing a device that needs it'
            );
        }
        createConvolver(): never {
            throw new Error(
                'nullTestRenderHarness models no ConvolverNode — implement one before fixturing a device that needs it'
            );
        }
        createOscillator(): never {
            throw new Error(
                'nullTestRenderHarness models no OscillatorNode — implement one before fixturing a device that needs it'
            );
        }
        createBufferSource(): never {
            throw new Error(
                'nullTestRenderHarness models no AudioBufferSourceNode — use createSignalSource for the fixture signal'
            );
        }

        async startRendering(): Promise<RenderedBuffer> {
            for (const param of this.params) {
                param.settle();
            }
            const left = new Float32Array(this.length);
            const right = new Float32Array(this.length);
            for (let frame = 0; frame < this.length; frame += QUANTUM_FRAMES) {
                harnessFrame = frame;
                this.currentTime = frame / this.sampleRate;
                const block = this.destination.render(frame / QUANTUM_FRAMES);
                const count = Math.min(QUANTUM_FRAMES, this.length - frame);
                left.set(block.left.subarray(0, count), frame);
                right.set(block.right.subarray(0, count), frame);
            }
            const channels = [left, right];
            return await Promise.resolve({
                sampleRate: this.sampleRate,
                length: this.length,
                numberOfChannels: 2,
                getChannelData: (channel: number) => channels[channel] ?? left,
            });
        }
    }

    return {
        installWorkletGlobals: ({ sampleRate }) => {
            Object.defineProperty(globalThis, 'currentFrame', { configurable: true, get: () => harnessFrame });
            Object.defineProperty(globalThis, 'sampleRate', { configurable: true, get: () => sampleRate });
            vi.stubGlobal('AudioWorkletProcessor', AudioWorkletProcessorShim);
            vi.stubGlobal('registerProcessor', (name: string, processor: new () => HarnessProcessorLike) => {
                processorRegistry.set(name, processor);
            });
        },
        OfflineAudioContext: HarnessOfflineAudioContext,
        AudioWorkletNode: HarnessAudioWorkletNode,
        registeredProcessorNames: () => [...processorRegistry.keys()],
    };
}

/** Peak absolute sample across every channel, as a linear amplitude. */
function peakAmplitude(buffer: RenderedBuffer): number {
    let peak = 0;
    for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
        const data = buffer.getChannelData(channel);
        for (const sample of data) {
            const magnitude = Math.abs(sample);
            if (magnitude > peak) {
                peak = magnitude;
            }
        }
    }
    return peak;
}

/** `20·log₁₀`, with a true zero reported as `-Infinity` rather than clamped. */
function amplitudeToDbfs(amplitude: number): number {
    if (amplitude === 0) {
        return -Infinity;
    }
    return 20 * Math.log10(amplitude);
}

export type NullTestResult = {
    /** Peak of `a − b`, in dBFS. `-Infinity` when the two renders are bit-identical. */
    residualPeakDbfs: number;
    /** Peak of `a`, in dBFS. The presence pin: a null against silence is not a null. */
    signalPeakDbfs: number;
    /** Frame index of the largest residual sample, for locating a divergence. */
    worstFrame: number;
};

/**
 * Subtract two renders sample-for-sample and report the peak of what is left.
 *
 * `signalPeakDbfs` is not decoration. Per ADR 0015 rule 4, an assertion that a
 * residual is absent is satisfied forever by two renders that are both silent —
 * which is precisely the failure `renderTrackSubgraphOffline` shipped (97–99 %
 * silence, INVENTORY-device-clock-parity G-1). Every caller must pin the signal.
 */
export function nullTest(input: { a: RenderedBuffer; b: RenderedBuffer }): NullTestResult {
    const { a, b } = input;
    if (a.length !== b.length || a.numberOfChannels !== b.numberOfChannels) {
        throw new Error(
            `nullTest needs two renders of the same shape; got ${a.numberOfChannels}×${a.length} and ${b.numberOfChannels}×${b.length}`
        );
    }
    let residual = 0;
    let worstFrame = -1;
    for (let channel = 0; channel < a.numberOfChannels; channel++) {
        const left = a.getChannelData(channel);
        const right = b.getChannelData(channel);
        for (let frame = 0; frame < a.length; frame++) {
            const difference = Math.abs(left[frame]! - right[frame]!);
            if (difference > residual) {
                residual = difference;
                worstFrame = frame;
            }
        }
    }
    return {
        residualPeakDbfs: amplitudeToDbfs(residual),
        signalPeakDbfs: amplitudeToDbfs(peakAmplitude(a)),
        worstFrame,
    };
}

/**
 * The fixture signal: broadband, deterministic, and different per channel.
 *
 * Broadband because a filter fixture is only tested by content at the cutoff;
 * deterministic because a null test that is nondeterministic proves nothing;
 * and asymmetric across channels because a pan-law divergence is invisible on a
 * mono-correlated signal. Generated from a plain LCG rather than `Math.random`
 * so two calls in the same run produce identical samples, which is what lets the
 * two legs be fed independent source nodes carrying the same audio.
 */
export function createFixtureSignal(input: { frames: number; sampleRate: number }): {
    left: Float32Array;
    right: Float32Array;
} {
    const left = new Float32Array(input.frames);
    const right = new Float32Array(input.frames);
    let seed = 0x2f6e_2b1;
    for (let frame = 0; frame < input.frames; frame++) {
        seed = (seed * 1_664_525 + 1_013_904_223) >>> 0;
        const noise = (seed / 0xffff_ffff) * 2 - 1;
        const time = frame / input.sampleRate;
        left[frame] = 0.25 * Math.sin(2 * Math.PI * 220 * time) + 0.1 * noise;
        right[frame] = 0.25 * Math.sin(2 * Math.PI * 330 * time + 0.7) + 0.1 * noise;
    }
    return { left, right };
}
