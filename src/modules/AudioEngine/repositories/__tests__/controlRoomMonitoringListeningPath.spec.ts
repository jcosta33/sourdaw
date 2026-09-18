import { beforeEach, describe, expect, it } from 'vitest';

import { controlRoomStore } from '#/modules/ControlRoom/stores';
import { getControlRoomHandlers } from '#/modules/ControlRoom/useCases';
import { dbToGain } from '#/utils/audioLevelLaw';

import { syncControlRoomMonitoring } from '../../useCases/engineAccess/syncControlRoomMonitoring';
import { createAudioEngine } from '../createWebAudioEngine';

import type { AudioEngine } from '../../models/AudioEngineState';

/**
 * A pull-rendering fixture for the live listening path, in the spirit of
 * `offlineWorkletRenderHarness`: a model, not a browser, that actually computes
 * the samples a control-room gesture produces.
 *
 * What it models beyond summing and gain multiplication is the one piece of Web
 * Audio channel algebra the insert relies on: a `GainNode` with
 * `channelCountMode: 'explicit'` and `channelCount: 1` downmixes its stereo
 * input per the speakers interpretation — (L+R)/2 — and the mono result upmixes
 * back onto both output channels. `channelCountMode: 'max'` is pass-through.
 * `setTargetAtTime` applies its target directly: the smoothing law is the
 * platform's; what this spec observes is which value the insert was given.
 * The graph itself is the engine's own wiring — the fixture only supplies the
 * nodes the engine asks the context for.
 */

const QUANTUM_FRAMES = 128;
const RENDER_FRAMES = 8192;
const SAMPLE_RATE = 48_000;

type StereoBlock = { left: Float32Array; right: Float32Array };

type FixtureParam = {
    value: number;
    setTargetAtTime: (target: number, startTime: number, timeConstant: number) => void;
};

function createParam(initialValue: number): FixtureParam {
    return {
        value: initialValue,
        setTargetAtTime(target: number): void {
            this.value = target;
        },
    };
}

abstract class FixtureNode {
    readonly sources: FixtureNode[] = [];
    readonly connectedTo: FixtureNode[] = [];
    numberOfInputs = 1;
    private renderedQuantum = -1;
    protected readonly out: StereoBlock = {
        left: new Float32Array(QUANTUM_FRAMES),
        right: new Float32Array(QUANTUM_FRAMES),
    };

    connect(target: FixtureNode, _outputIndex?: number): FixtureNode {
        this.connectedTo.push(target);
        target.sources.push(this);
        return target;
    }

    disconnect(): void {}

    render(quantum: number): StereoBlock {
        if (this.renderedQuantum === quantum) {
            return this.out;
        }
        // Marked before recursing so a fan-out is summed once.
        this.renderedQuantum = quantum;
        this.out.left.fill(0);
        this.out.right.fill(0);
        for (const source of this.sources) {
            const input = source.render(quantum);
            for (let index = 0; index < QUANTUM_FRAMES; index++) {
                this.out.left[index] = (this.out.left[index] ?? 0) + (input.left[index] ?? 0);
                this.out.right[index] = (this.out.right[index] ?? 0) + (input.right[index] ?? 0);
            }
        }
        this.transform();
        return this.out;
    }

    protected abstract transform(): void;
}

class FixtureGainNode extends FixtureNode {
    readonly gain = createParam(1);
    channelCount = 2;
    channelCountMode: ChannelCountMode = 'max';
    channelInterpretation: ChannelInterpretation = 'speakers';

    protected override transform(): void {
        // The speakers-interpretation fold the monitoring insert relies on:
        // an explicit single-channel count downmixes (L+R)/2 and the mono
        // result upmixes back onto both output channels.
        if (this.channelCountMode === 'explicit' && this.channelCount === 1) {
            for (let index = 0; index < QUANTUM_FRAMES; index++) {
                const mono = ((this.out.left[index] ?? 0) + (this.out.right[index] ?? 0)) / 2;
                this.out.left[index] = mono;
                this.out.right[index] = mono;
            }
        }
        const level = this.gain.value;
        if (level === 1) {
            return;
        }
        for (let index = 0; index < QUANTUM_FRAMES; index++) {
            this.out.left[index] = (this.out.left[index] ?? 0) * level;
            this.out.right[index] = (this.out.right[index] ?? 0) * level;
        }
    }
}

/** Pass-through tap that remembers every frame rendered through it. */
class FixtureAnalyserNode extends FixtureNode {
    fftSize = 2048;
    smoothingTimeConstant = 0.8;
    private readonly chunks: StereoBlock[] = [];

    protected override transform(): void {
        this.chunks.push({
            left: Float32Array.from(this.out.left),
            right: Float32Array.from(this.out.right),
        });
    }

    stitchedCapture(): StereoBlock {
        const frames = this.chunks.length * QUANTUM_FRAMES;
        const left = new Float32Array(frames);
        const right = new Float32Array(frames);
        for (const [chunkIndex, chunk] of this.chunks.entries()) {
            left.set(chunk.left, chunkIndex * QUANTUM_FRAMES);
            right.set(chunk.right, chunkIndex * QUANTUM_FRAMES);
        }
        return { left, right };
    }
}

/** A started source renders its (looping) buffer; per-channel data is honoured. */
class FixtureBufferSourceNode extends FixtureNode {
    buffer: { getChannelData(channel: number): Float32Array } | null = null;
    override numberOfInputs = 0;
    private started = false;

    start(): void {
        this.started = true;
    }

    stop(): void {
        this.started = false;
    }

    protected override transform(): void {
        if (!this.started || !this.buffer) {
            this.out.left.fill(0);
            this.out.right.fill(0);
            return;
        }
        const left = this.buffer.getChannelData(0);
        const right = this.buffer.getChannelData(1);
        for (let index = 0; index < QUANTUM_FRAMES; index++) {
            this.out.left[index] = left[index % left.length] ?? 0;
            this.out.right[index] = right[index % right.length] ?? 0;
        }
    }
}

class FixtureChannelSplitterNode extends FixtureNode {
    // Output indexing is not modelled; the tap branch is pass-through.
    protected override transform(): void {}
}

class ListeningFixtureContext {
    readonly destination = new FixtureGainNode();
    readonly sampleRate = SAMPLE_RATE;
    currentTime = 0;
    state = 'running';

    createGain(): FixtureGainNode {
        return new FixtureGainNode();
    }

    createAnalyser(): FixtureAnalyserNode {
        return new FixtureAnalyserNode();
    }

    createChannelSplitter(): FixtureChannelSplitterNode {
        return new FixtureChannelSplitterNode();
    }

    createBufferSource(): FixtureBufferSourceNode {
        return new FixtureBufferSourceNode();
    }

    async startRendering(): Promise<StereoBlock> {
        const left = new Float32Array(RENDER_FRAMES);
        const right = new Float32Array(RENDER_FRAMES);
        for (let frame = 0; frame < RENDER_FRAMES; frame += QUANTUM_FRAMES) {
            this.currentTime = frame / this.sampleRate;
            const block = this.destination.render(frame / QUANTUM_FRAMES);
            left.set(block.left, frame);
            right.set(block.right, frame);
        }
        return { left, right };
    }
}

/** Constant asymmetric signal — a hard-left or hard-right programme. */
function createProgrammeBuffer(left: number, right: number): { getChannelData(channel: number): Float32Array } {
    return {
        getChannelData(channel: number): Float32Array {
            return new Float32Array(QUANTUM_FRAMES).fill(channel === 0 ? left : right);
        },
    };
}

function maxAbs(data: Float32Array): number {
    let peak = 0;
    for (const sample of data) {
        peak = Math.max(peak, Math.abs(sample));
    }
    return peak;
}

type DrivenEngine = {
    context: ListeningFixtureContext;
    /** The real engine contract the one-arg factory returns (not the test-only topology harness). */
    engine: AudioEngine;
    unsubscribe: () => void;
};

function createDrivenEngine(): DrivenEngine {
    const context = new ListeningFixtureContext();
    // The fixture is structurally the BaseAudioContext the engine asks for;
    // this is the same boundary cast every audio fixture here makes.
    const engine = createAudioEngine(context as unknown as AudioContext);
    // Unity fader so observed amplitudes are exact ratios of the programme.
    (engine.masterGainNode as unknown as FixtureGainNode).gain.value = 1;
    // The real sync, named onto this fixture engine — the app wiring passes
    // nothing and gets the singleton; the seam is the sync's own parameter.
    return { context, engine, unsubscribe: syncControlRoomMonitoring(engine) };
}

function connectProgrammeBuffer(driven: DrivenEngine, left: number, right: number): void {
    const source = driven.context.createBufferSource();
    source.buffer = createProgrammeBuffer(left, right);
    source.connect(driven.engine.masterGainNode as unknown as FixtureNode);
    source.start();
}

function executeToggle(action: 'toggleControlRoomMono' | 'toggleControlRoomDim'): void {
    const handlers = getControlRoomHandlers();
    // Each action dispatches through its own real handler with its own typed
    // action; a union-keyed lookup would collapse `execute`'s parameter to never.
    if (action === 'toggleControlRoomMono') {
        handlers.toggleControlRoomMono.execute({ type: 'toggleControlRoomMono' });
    } else {
        handlers.toggleControlRoomDim.execute({ type: 'toggleControlRoomDim' });
    }
}

function resetMonitoringState(): void {
    controlRoomStore.update((state) =>
        state ? { ...state, monoActive: false, dimActive: false, dimLevel: -20 } : state
    );
}

describe('control room monitoring on the listening path', () => {
    let driven: DrivenEngine;

    beforeEach(() => {
        resetMonitoringState();
        driven = createDrivenEngine();
    });

    it('passes the programme through untouched while both toggles are off', async () => {
        connectProgrammeBuffer(driven, 0.5, 0);

        const output = await driven.context.startRendering();

        expect(maxAbs(output.left)).toBeCloseTo(0.5, 5);
        expect(maxAbs(output.right)).toBeCloseTo(0, 5);
    });

    it('mono folds a hard-left programme to equal channels on the listening output', async () => {
        executeToggle('toggleControlRoomMono');
        expect(controlRoomStore.value?.monoActive).toBe(true);

        connectProgrammeBuffer(driven, 0.5, 0);

        const output = await driven.context.startRendering();

        // (0.5 + 0) / 2 on every output channel — the mono-compatibility fold.
        expect(maxAbs(output.left)).toBeCloseTo(0.25, 5);
        expect(maxAbs(output.right)).toBeCloseTo(0.25, 5);
    });

    it('dim attenuates the listening feed by the store dim level and nothing else', async () => {
        executeToggle('toggleControlRoomDim');

        connectProgrammeBuffer(driven, 0.5, 0.25);

        const output = await driven.context.startRendering();

        const dimGain = dbToGain(controlRoomStore.value?.dimLevel ?? 0);
        expect(dimGain).toBeLessThan(1);
        expect(maxAbs(output.left)).toBeCloseTo(0.5 * dimGain, 5);
        expect(maxAbs(output.right)).toBeCloseTo(0.25 * dimGain, 5);
    });

    it('mono and dim compose on the listening output', async () => {
        executeToggle('toggleControlRoomMono');
        executeToggle('toggleControlRoomDim');

        connectProgrammeBuffer(driven, 0.5, 0);

        const output = await driven.context.startRendering();

        const dimGain = dbToGain(controlRoomStore.value?.dimLevel ?? 0);
        expect(maxAbs(output.left)).toBeCloseTo(0.25 * dimGain, 5);
        expect(maxAbs(output.right)).toBeCloseTo(0.25 * dimGain, 5);
    });

    it('the programme tap upstream of the insert never sees the monitoring', async () => {
        connectProgrammeBuffer(driven, 0.5, 0);
        await driven.context.startRendering();
        const analyser = driven.engine.masterAnalyser as unknown as FixtureAnalyserNode;
        const before = analyser.stitchedCapture();

        executeToggle('toggleControlRoomMono');
        executeToggle('toggleControlRoomDim');
        await driven.context.startRendering();
        const after = analyser.stitchedCapture();

        // The master analyser sits above the insert: the programme it taps —
        // what the meters and every export read — is identical with monitoring
        // fully engaged, while the destination below the insert is not. The
        // second render appended to the capture, so compare window to window.
        expect(after.left.length).toBe(RENDER_FRAMES * 2);
        const afterWindow = { left: after.left.subarray(RENDER_FRAMES), right: after.right.subarray(RENDER_FRAMES) };
        expect(Array.from(afterWindow.left)).toEqual(Array.from(before.left));
        expect(Array.from(afterWindow.right)).toEqual(Array.from(before.right));
    });

    it('follows a dim level the store changes after the subscription exists', async () => {
        executeToggle('toggleControlRoomDim');
        controlRoomStore.update((state) => (state ? { ...state, dimLevel: -40 } : state));

        connectProgrammeBuffer(driven, 0.5, 0);

        const output = await driven.context.startRendering();

        expect(maxAbs(output.left)).toBeCloseTo(0.5 * dbToGain(-40), 5);
    });

    it('stops following the store once unsubscribed', async () => {
        driven.unsubscribe();
        executeToggle('toggleControlRoomMono');

        connectProgrammeBuffer(driven, 0.5, 0);

        const output = await driven.context.startRendering();

        expect(maxAbs(output.left)).toBeCloseTo(0.5, 5);
        expect(maxAbs(output.right)).toBeCloseTo(0, 5);
    });

    it('inserts strictly between the master analyser and the destination', () => {
        // Walk the live graph upward from the destination: the single audible
        // feeder chain must be destination <- dim <- mono <- masterAnalyser,
        // and the analyser must hold no direct edge to the destination.
        const audibleFeeder = driven.context.destination.sources.find(
            (node): node is FixtureGainNode => node instanceof FixtureGainNode && node.gain.value === 1
        );
        const monoInsert = audibleFeeder?.sources[0];
        expect(audibleFeeder).toBeInstanceOf(FixtureGainNode);
        expect(monoInsert).toBeInstanceOf(FixtureGainNode);
        expect(monoInsert?.sources).toContain(driven.engine.masterAnalyser);

        const analyserEdges = (driven.engine.masterAnalyser as unknown as FixtureNode).connectedTo;
        expect(analyserEdges).not.toContain(driven.context.destination);
    });
});
