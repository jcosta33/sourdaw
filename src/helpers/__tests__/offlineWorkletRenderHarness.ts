import { vi } from 'vitest';

/**
 * A pull-rendering stand-in for `OfflineAudioContext` that actually runs
 * `AudioWorkletProcessor.process()`.
 *
 * jsdom has no Web Audio implementation and `setupTests.ts` provides only enough
 * of one for `instanceof` checks and node construction, so nothing in the suite
 * could previously assert what an offline render *sounds* like — only which
 * calls it made. That is exactly the wrong instrument for a class of defect where
 * the calls are all correct and the samples are silence: Grand Boule's export was
 * 97–99 % silent while every note reached the engine (INVENTORY-device-clock-parity
 * G-1), and freeze then baked that silence over the track (G-6).
 *
 * This renders. Nodes sum their inputs, gains multiply, panners pan, and a worklet
 * node calls its registered processor once per 128-frame quantum with the real
 * `currentFrame` advancing underneath it. `startRendering()` walks the quanta
 * synchronously and yields only at a `suspend()` checkpoint, which is how a real
 * offline render behaves: it has no deadline (Web Audio §2.6), it does not
 * interleave with the main thread's macrotask queue between quanta, and the
 * suspend/resume round trip is the one place another thread gets a turn.
 *
 * It is a model, not a browser. Delay lines do not delay, and an oscillator
 * emits a plain sine between its start and stop times whatever waveform it was
 * asked for — audible, because the builtin fallback synth is built out of
 * oscillators and a silent one would make a wrong-instrument substitution
 * invisible to every spec that asserts its absence. Assert on energy in a
 * region, not on waveform fidelity.
 */

/** The Web Audio render quantum. */
export const HARNESS_QUANTUM_FRAMES = 128;

export type HarnessStereoBlock = { left: Float32Array; right: Float32Array };

export type HarnessProcessorLike = {
    process: (inputs: Float32Array[][], outputs: Float32Array[][]) => boolean;
};

export type HarnessPort = {
    onmessage: ((event: MessageEvent) => void) | null;
    postMessage: (message: unknown) => void;
    close: () => void;
};

function createParam(value: number) {
    return {
        value,
        setValueAtTime: vi.fn(),
        setTargetAtTime: vi.fn(),
        linearRampToValueAtTime: vi.fn(),
        exponentialRampToValueAtTime: vi.fn(),
        cancelScheduledValues: vi.fn(),
    };
}

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

export type OfflineWorkletRenderHarness = {
    /**
     * Install the `AudioWorkletGlobalScope` globals a processor module reads at
     * import time. Call before importing any processor module.
     */
    installWorkletGlobals: (input: { sampleRate: number }) => void;
    /** Stub as the global `OfflineAudioContext`. */
    OfflineAudioContext: new (numberOfChannels: number, length: number, sampleRate: number) => unknown;
    /** Stub as the global `AudioWorkletNode`. */
    AudioWorkletNode: new (context: unknown, processorName: string, options?: AudioWorkletNodeOptions) => unknown;
    /** Names registered so far, for asserting which processor a factory built. */
    registeredProcessorNames: () => string[];
};

export function createOfflineWorkletRenderHarness(): OfflineWorkletRenderHarness {
    const processorRegistry = new Map<string, new (...args: unknown[]) => HarnessProcessorLike>();
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

    class HarnessAudioNode {
        readonly sources: HarnessAudioNode[] = [];
        numberOfInputs = 1;
        numberOfOutputs = 1;
        protected readonly out: HarnessStereoBlock = {
            left: new Float32Array(HARNESS_QUANTUM_FRAMES),
            right: new Float32Array(HARNESS_QUANTUM_FRAMES),
        };
        private renderedQuantum = -1;

        connect(destination: unknown): unknown {
            if (destination instanceof HarnessAudioNode) {
                destination.sources.push(this);
            }
            return destination;
        }

        disconnect(): void {}

        render(quantum: number): HarnessStereoBlock {
            if (this.renderedQuantum === quantum) {
                return this.out;
            }
            // Marked before recursing so a fan-out is summed once and a cycle
            // cannot spin the stack instead of failing legibly.
            this.renderedQuantum = quantum;
            this.out.left.fill(0);
            this.out.right.fill(0);
            for (const source of this.sources) {
                const input = source.render(quantum);
                for (let index = 0; index < HARNESS_QUANTUM_FRAMES; index++) {
                    this.out.left[index] = (this.out.left[index] ?? 0) + (input.left[index] ?? 0);
                    this.out.right[index] = (this.out.right[index] ?? 0) + (input.right[index] ?? 0);
                }
            }
            this.transform();
            return this.out;
        }

        protected transform(): void {}
    }

    class HarnessGainNode extends HarnessAudioNode {
        readonly gain = createParam(1);
        protected override transform(): void {
            const level = this.gain.value;
            if (level === 1) {
                return;
            }
            for (let index = 0; index < HARNESS_QUANTUM_FRAMES; index++) {
                this.out.left[index] = (this.out.left[index] ?? 0) * level;
                this.out.right[index] = (this.out.right[index] ?? 0) * level;
            }
        }
    }

    class HarnessStereoPannerNode extends HarnessAudioNode {
        readonly pan = createParam(0);
        protected override transform(): void {
            const position = this.pan.value;
            if (position === 0) {
                return;
            }
            const angle = ((position + 1) / 2) * (Math.PI / 2);
            const leftGain = Math.cos(angle);
            const rightGain = Math.sin(angle);
            for (let index = 0; index < HARNESS_QUANTUM_FRAMES; index++) {
                this.out.left[index] = (this.out.left[index] ?? 0) * leftGain;
                this.out.right[index] = (this.out.right[index] ?? 0) * rightGain;
            }
        }
    }

    /** Pass-through: nothing under test here depends on the delay being real. */
    class HarnessDelayNode extends HarnessAudioNode {
        readonly delayTime = createParam(0);
    }

    class HarnessBufferSourceNode extends HarnessAudioNode {
        buffer: AudioBuffer | null = null;
        readonly playbackRate = createParam(1);
        readonly detune = createParam(0);
        override numberOfInputs = 0;
        start(): void {}
        stop(): void {}
    }

    /**
     * Audible between `start()` and `stop()`, like a real `OscillatorNode`, and
     * that is load-bearing rather than a fidelity upgrade.
     *
     * `scheduleTrackClips` builds the builtin fallback synth out of these when a
     * track has no instrument. A silent oscillator does not stop that
     * substitution — it *hides* it: the fallback renders as zeros, so a spec
     * asserting the fallback is absent passes whether or not it happened. This
     * harness was written the other way round on the theory that silence stopped
     * a test passing *on* the fallback, which is true only for a spec asserting
     * energy. Every spec here asserts its absence, so the polarity was inverted
     * and the guard was blind.
     *
     * It is still a model. It emits a plain sine at `frequency.value` whatever
     * `type` says, and `setValueAtTime` is a spy, so a note's scheduled pitch
     * and envelope do not reach it. Assert on energy in a region, not on
     * waveform fidelity or pitch.
     */
    class HarnessOscillatorNode extends HarnessAudioNode {
        type = 'sine';
        readonly frequency = createParam(440);
        readonly detune = createParam(0);
        override numberOfInputs = 0;
        private startSeconds: number | null = null;
        private stopSeconds = Number.POSITIVE_INFINITY;

        constructor(private readonly nodeSampleRate: number) {
            super();
        }

        start(when = 0): void {
            this.startSeconds = when;
        }
        stop(when = Number.POSITIVE_INFINITY): void {
            this.stopSeconds = when;
        }

        protected override transform(): void {
            if (this.startSeconds === null) {
                return;
            }
            const step = (2 * Math.PI * this.frequency.value) / this.nodeSampleRate;
            for (let index = 0; index < HARNESS_QUANTUM_FRAMES; index++) {
                const frame = harnessFrame + index;
                const seconds = frame / this.nodeSampleRate;
                if (seconds < this.startSeconds || seconds >= this.stopSeconds) {
                    continue;
                }
                const sample = Math.sin(step * frame);
                this.out.left[index] = (this.out.left[index] ?? 0) + sample;
                this.out.right[index] = (this.out.right[index] ?? 0) + sample;
            }
        }
    }

    class HarnessBiquadFilterNode extends HarnessAudioNode {
        type = 'lowpass';
        readonly frequency = createParam(350);
        readonly detune = createParam(0);
        readonly Q = createParam(1);
        readonly gain = createParam(0);
    }

    class HarnessAudioWorkletNode extends HarnessAudioNode {
        readonly port: HarnessPort;
        private readonly processor: HarnessProcessorLike;

        constructor(_context: unknown, processorName: string, options?: AudioWorkletNodeOptions) {
            super();
            this.numberOfInputs = options?.numberOfInputs ?? 1;
            const Processor = processorRegistry.get(processorName);
            if (!Processor) {
                throw new Error(`AudioWorklet processor "${processorName}" is not registered`);
            }
            const { outer, inner } = createPortPair();
            this.port = outer;
            pendingProcessorPort = inner;
            try {
                this.processor = new Processor(options);
            } finally {
                pendingProcessorPort = null;
            }
        }

        protected override transform(): void {
            this.processor.process([], [[this.out.left, this.out.right]]);
        }
    }

    class HarnessOfflineAudioContext {
        readonly destination = new HarnessAudioNode();
        readonly audioWorklet = { addModule: (): Promise<void> => Promise.resolve() };
        currentTime = 0;
        state = 'suspended';
        private readonly checkpoints = new Map<number, () => void>();
        private resumeRender: (() => void) | null = null;

        constructor(
            readonly numberOfChannels: number,
            readonly length: number,
            readonly sampleRate: number
        ) {}

        createGain(): HarnessGainNode {
            return new HarnessGainNode();
        }
        createStereoPanner(): HarnessStereoPannerNode {
            return new HarnessStereoPannerNode();
        }
        createDelay(): HarnessDelayNode {
            return new HarnessDelayNode();
        }
        createBufferSource(): HarnessBufferSourceNode {
            return new HarnessBufferSourceNode();
        }
        createOscillator(): HarnessOscillatorNode {
            return new HarnessOscillatorNode(this.sampleRate);
        }
        createBiquadFilter(): HarnessBiquadFilterNode {
            return new HarnessBiquadFilterNode();
        }

        suspend(seconds: number): Promise<void> {
            const frame = Math.round(seconds * this.sampleRate);
            return new Promise<void>((resolve) => {
                this.checkpoints.set(frame, resolve);
            });
        }

        resume(): Promise<void> {
            const resume = this.resumeRender;
            this.resumeRender = null;
            resume?.();
            return Promise.resolve();
        }

        async startRendering(): Promise<AudioBuffer> {
            const left = new Float32Array(this.length);
            const right = new Float32Array(this.length);

            for (let frame = 0; frame < this.length; frame += HARNESS_QUANTUM_FRAMES) {
                const checkpoint = this.checkpoints.get(frame);
                if (checkpoint) {
                    this.checkpoints.delete(frame);
                    const resumed = new Promise<void>((resolve) => {
                        this.resumeRender = resolve;
                    });
                    checkpoint();
                    await resumed;
                    // A suspended render hands the thread back. This is the only
                    // window in which another thread's macrotask loop can run,
                    // which is why a producer paced by that queue delivers
                    // islands of content at the checkpoints and silence between.
                    await new Promise((resolve) => setTimeout(resolve, 0));
                }

                harnessFrame = frame;
                this.currentTime = frame / this.sampleRate;
                const block = this.destination.render(frame / HARNESS_QUANTUM_FRAMES);
                const count = Math.min(HARNESS_QUANTUM_FRAMES, this.length - frame);
                left.set(block.left.subarray(0, count), frame);
                right.set(block.right.subarray(0, count), frame);
            }

            const channels = [left, right];
            const buffer: Pick<
                AudioBuffer,
                'duration' | 'length' | 'numberOfChannels' | 'sampleRate' | 'getChannelData'
            > = {
                duration: this.length / this.sampleRate,
                length: this.length,
                numberOfChannels: 2,
                sampleRate: this.sampleRate,
                getChannelData: (channel: number) => channels[channel] ?? left,
            };
            // Structurally an `AudioBuffer` for everything the render path reads;
            // `copyFromChannel`/`copyToChannel` are not modelled because nothing
            // under test calls them, and a stub that silently did nothing would
            // be worse than an absent one.
            return buffer as AudioBuffer;
        }
    }

    return {
        installWorkletGlobals: ({ sampleRate }) => {
            Object.defineProperty(globalThis, 'currentFrame', { configurable: true, get: () => harnessFrame });
            Object.defineProperty(globalThis, 'sampleRate', { configurable: true, get: () => sampleRate });
            vi.stubGlobal('AudioWorkletProcessor', AudioWorkletProcessorShim);
            vi.stubGlobal(
                'registerProcessor',
                (name: string, processor: new (...args: unknown[]) => HarnessProcessorLike) => {
                    processorRegistry.set(name, processor);
                }
            );
        },
        OfflineAudioContext: HarnessOfflineAudioContext,
        AudioWorkletNode: HarnessAudioWorkletNode,
        registeredProcessorNames: () => [...processorRegistry.keys()],
    };
}

/** Root-mean-square of `[startSeconds, endSeconds)` on one channel of `buffer`. */
export function harnessRmsBetween(input: {
    buffer: AudioBuffer;
    startSeconds: number;
    endSeconds: number;
    channel?: number;
}): number {
    const data = input.buffer.getChannelData(input.channel ?? 0);
    const start = Math.max(0, Math.floor(input.startSeconds * input.buffer.sampleRate));
    const end = Math.min(data.length, Math.floor(input.endSeconds * input.buffer.sampleRate));
    let total = 0;
    for (let index = start; index < end; index++) {
        total += (data[index] ?? 0) ** 2;
    }
    return Math.sqrt(total / Math.max(1, end - start));
}
