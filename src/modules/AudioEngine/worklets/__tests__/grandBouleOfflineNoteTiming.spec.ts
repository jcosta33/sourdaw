import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

import {
    NATIVE_DSP_DEVICE_FACTORIES,
    type NativeDspNode,
} from '../../repositories/deviceStrategy/nativeDspDeviceFactories';
import { NativeDspDeviceStrategy } from '../../repositories/deviceStrategy/NativeDspDeviceStrategy';
import { schedulePendingSuspends } from '../../useCases/offlineRender/schedulePendingSuspends';
import { type PendingWorkletEvent } from '../../useCases/offlineRender/types';

// End-to-end timing proof for Grand Boule's offline note path, wired out of
// production parts only: the real factory table -> the real
// `NativeDspDeviceStrategy` -> the real `schedulePendingSuspends` -> the real
// `createGrandBouleNode` -> the real offline processor.
//
// This spec used to drive the engine Worker, because offline Grand Boule went
// through the same Worker and SAB ring as live playback. It does not any more:
// an `OfflineAudioContext` has no deadline for the ring to protect and the ring's
// back-pressure is what starved exports into silence, so the offline transport
// runs the engine inside the worklet. The assertion below survives that move
// unchanged — note N is voiced in block M — because it was never about the ring.
// Only the clock the block index is read off changed: the ring write head became
// `currentFrame`, which is the whole point of the transport split.
//
// Nothing here asserts a call *shape*: a message that carries a `sampleFrame`
// field and ignores it passes a shape assertion. What is measured is *when* the
// engine is told to voice, expressed as the render block the processor was
// producing at the moment `note_on_with_channel` ran.

const BLOCK_FRAMES = 128;

/** The offline context's rate. Deliberately small so frame numbers stay legible. */
const OFFLINE_SAMPLE_RATE = 1000;

/** `\0asm` + version 1 — the shortest byte string `WebAssembly.compile` accepts. */
const EMPTY_WASM_MODULE = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]).buffer;

let harnessFrame = 0;

/** Render block index the processor is producing, read off the worklet clock. */
function currentBlock(): number {
    return harnessFrame / BLOCK_FRAMES;
}

type Dispatch = { note: number; velocity: number; channel: number; block: number };
const dispatches: Dispatch[] = [];
type ParamDispatch = { name: string; value: number; block: number };
const paramDispatches: ParamDispatch[] = [];
const engineEvents: string[] = [];

const wasmStub = vi.hoisted(() => {
    const memory = new WebAssembly.Memory({ initial: 1 });
    return { memory, LEFT_PTR: 0, RIGHT_PTR: 4096 * Float32Array.BYTES_PER_ELEMENT };
});

class GrandBouleInstanceMock {
    note_on_with_channel(note: number, velocity: number, channel: number): void {
        dispatches.push({ note, velocity, channel, block: currentBlock() });
        engineEvents.push(`note:${String(note)}`);
    }
    note_on(_note: number, _velocity: number): void {}
    note_off(_note: number): void {}
    note_off_on_channel(_note: number, _channel: number): void {}
    note_expression(): void {}
    set_param(name: string, value: number): void {
        paramDispatches.push({ name, value, block: currentBlock() });
        engineEvents.push(`param:${name}:${String(value)}`);
    }
    set_sustain(_position: number): void {}
    set_una_corda(_engaged: boolean): void {}
    set_sostenuto(_engaged: boolean): void {}
    note_on_midi2(): void {}
    set_temperament(_index: number): void {}
    load_attack_clip(): void {}
    all_notes_off(): void {}
    process(_frames: number): number {
        return wasmStub.LEFT_PTR;
    }
    get_right_ptr(): number {
        return wasmStub.RIGHT_PTR;
    }
}

vi.mock('../../wasm/daw_dsp.js', () => ({
    initSync: vi.fn(() => ({ memory: wasmStub.memory })),
}));
vi.mock('../grandBouleWasmInstance', () => ({
    createGrandBouleWasmInstance: () => new GrandBouleInstanceMock(),
}));

vi.mock('../grandBouleProcessor.ts?worker&url', () => ({ default: 'grand-boule-processor-url' }));
vi.mock('../grandBouleOfflineProcessor.ts?worker&url', () => ({ default: 'grand-boule-offline-processor-url' }));

// The factory table imports every engine node at module load; stub the ones this
// spec does not drive so no real worklet or WASM module is pulled in.
vi.mock('../../engine/FermenterNode', () => ({ isFermenterDevice: () => false, createFermenterNode: vi.fn() }));
vi.mock('../../engine/ToasterNode', () => ({ isToasterDevice: () => false, createToasterNode: vi.fn() }));
vi.mock('../../engine/LevainNode', () => ({ isLevainDevice: () => false, createLevainNode: vi.fn() }));
vi.mock('../../engine/CrumbsNode', () => ({ isCrumbsDevice: () => false, createCrumbsNode: vi.fn() }));
vi.mock('../../engine/GlutenNode', () => ({ isGlutenDevice: () => false, createGlutenNode: vi.fn() }));
vi.mock('../../engine/BacteriaNode', () => ({ isBacteriaDevice: () => false, createBacteriaNode: vi.fn() }));
vi.mock('../../engine/GrinderNode', () => ({ isGrinderDevice: () => false, createGrinderNode: vi.fn() }));
vi.mock('../../engine/ProofNode', () => ({ isProofDevice: () => false, createProofNode: vi.fn() }));
vi.mock('../../engine/ProofChamberNode', () => ({
    isProofChamberDevice: () => false,
    createProofChamberNode: vi.fn(),
}));
vi.mock('../../engine/ScoringNode', () => ({ isScoringDevice: () => false, createScoringNode: vi.fn() }));
vi.mock('../../engine/KneadNode', () => ({ isKneadDevice: () => false, createKneadNode: vi.fn() }));

// ---------------------------------------------------------------------------
// Worklet host
// ---------------------------------------------------------------------------

type ProcessorLike = { process: (inputs: Float32Array[][], outputs: Float32Array[][]) => boolean };
type HarnessPort = {
    onmessage: ((event: MessageEvent) => void) | null;
    postMessage: (message: unknown) => void;
    close: () => void;
};

const processorRegistry = new Map<string, new (...args: unknown[]) => ProcessorLike>();
let pendingProcessorPort: HarnessPort | null = null;
let liveProcessor: ProcessorLike | null = null;

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

class AudioWorkletProcessorShim {
    readonly port: HarnessPort;
    constructor() {
        if (!pendingProcessorPort) {
            throw new Error('AudioWorkletProcessorShim constructed outside a harness worklet node');
        }
        this.port = pendingProcessorPort;
    }
}

class HarnessAudioWorkletNode {
    readonly port: HarnessPort;
    readonly numberOfInputs = 0;
    constructor(_context: unknown, processorName: string, options?: AudioWorkletNodeOptions) {
        const Processor = processorRegistry.get(processorName);
        if (!Processor) {
            throw new Error(`AudioWorklet processor "${processorName}" is not registered`);
        }
        const { outer, inner } = createPortPair();
        this.port = outer;
        pendingProcessorPort = inner;
        try {
            liveProcessor = new Processor(options);
        } finally {
            pendingProcessorPort = null;
        }
    }
    connect(): void {}
    disconnect(): void {}
}

class HarnessOfflineAudioContext {
    readonly audioWorklet = { addModule: (): Promise<void> => Promise.resolve() };
    readonly sampleRate = OFFLINE_SAMPLE_RATE;
    readonly currentTime = 0;
    readonly state = 'suspended';
}

/** Render one quantum, then advance the worklet clock past it. */
function renderBlock(): void {
    liveProcessor?.process([], [[new Float32Array(BLOCK_FRAMES), new Float32Array(BLOCK_FRAMES)]]);
    harnessFrame += BLOCK_FRAMES;
}

function retainedAutomationScheduleCount(): number {
    const slots: unknown = Reflect.get(liveProcessor ?? {}, '_paramAutomation');
    if (!Array.isArray(slots)) {
        return 0;
    }
    let count = 0;
    for (const slot of slots) {
        if (Array.isArray(slot)) {
            count += slot.length;
        }
    }
    return count;
}

async function buildGrandBouleStrategy(): Promise<NativeDspDeviceStrategy> {
    const factory = NATIVE_DSP_DEVICE_FACTORIES.find((candidate) => candidate.matches('grand-boule'));
    if (!factory) {
        throw new Error('no factory claims the grand-boule device type');
    }
    const node: NativeDspNode = await factory.create(new HarnessOfflineAudioContext() as unknown as BaseAudioContext);
    await node.ready;
    return new NativeDspDeviceStrategy(node);
}

function noteOnEvent(time: number, pitch: number, controls: PendingWorkletEvent['instrumentControls']) {
    return {
        time,
        type: 'on',
        pitch,
        velocity: 90,
        instrumentControls: controls,
        isToaster: false,
        toasterPadIndex: -1,
    } satisfies PendingWorkletEvent;
}

describe('offline Grand Boule scheduling reaches the engine at the scheduled frame', () => {
    beforeAll(async () => {
        Object.defineProperty(globalThis, 'currentFrame', { configurable: true, get: () => harnessFrame });
        Object.defineProperty(globalThis, 'sampleRate', { configurable: true, get: () => OFFLINE_SAMPLE_RATE });
        vi.stubGlobal('AudioWorkletProcessor', AudioWorkletProcessorShim);
        vi.stubGlobal('registerProcessor', (name: string, processor: new (...args: unknown[]) => ProcessorLike) => {
            processorRegistry.set(name, processor);
        });
        await import('../grandBouleOfflineProcessor');
    });

    beforeEach(() => {
        dispatches.length = 0;
        paramDispatches.length = 0;
        engineEvents.length = 0;
        harnessFrame = 0;
        liveProcessor = null;
        vi.stubGlobal('OfflineAudioContext', HarnessOfflineAudioContext);
        vi.stubGlobal('AudioWorkletNode', HarnessAudioWorkletNode);
        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue({ ok: true, arrayBuffer: () => Promise.resolve(EMPTY_WASM_MODULE.slice(0)) })
        );
    });

    it('holds each note until the render block that contains its frame', async () => {
        const strategy = await buildGrandBouleStrategy();
        const offlineCtx = { sampleRate: OFFLINE_SAMPLE_RATE } as unknown as OfflineAudioContext;

        schedulePendingSuspends(offlineCtx, [noteOnEvent(0.2, 60, strategy), noteOnEvent(0.5, 64, strategy)], 4);

        // Every note of an offline part is posted before rendering starts, so
        // scheduling must voice nothing — the processor queues them.
        expect({ dispatches, blockBeforeRender: currentBlock() }).toEqual({
            dispatches: [],
            blockBeforeRender: 0,
        });

        for (let block = 0; block < 8; block++) {
            renderBlock();
        }

        // Block b carries frames b*128 .. b*128+127. Frame 200 sits inside
        // block 1 (128..255) and frame 500 inside block 3 (384..511). Both are
        // strictly interior, so this does not depend on how the drain treats a
        // frame landing exactly on a block boundary.
        expect(dispatches.map(({ note, block }) => ({ note, block }))).toEqual([
            { note: 60, block: 1 },
            { note: 64, block: 3 },
        ]);
    });

    it('does not hand the engine a frame number where an MPE channel belongs', async () => {
        const strategy = await buildGrandBouleStrategy();
        const offlineCtx = { sampleRate: OFFLINE_SAMPLE_RATE } as unknown as OfflineAudioContext;

        schedulePendingSuspends(offlineCtx, [noteOnEvent(0.2, 60, strategy)], 4);
        for (let block = 0; block < 4; block++) {
            renderBlock();
        }

        // An offline part carries no per-note expression, so every voice belongs
        // on the base channel. `note_on_with_channel` takes a `u8`, so a frame
        // number here is truncated into a real member channel and the voice
        // becomes unreachable to channel-addressed release and expression.
        expect(dispatches).toEqual([{ note: 60, velocity: 90, channel: 0, block: 1 }]);
    });

    it('applies lid automation across the offline render blocks', async () => {
        const strategy = await buildGrandBouleStrategy();
        const binding = strategy.resolveOfflineAutomation('lidPosition');
        expect(binding?.kind).toBe('segments');
        if (!binding || binding.kind !== 'segments') {
            throw new Error('Grand Boule did not expose lid automation to offline rendering');
        }

        binding.apply([
            { startFrame: 0, endFrame: 256, startValue: 1, endValue: 0.5 },
            { startFrame: 256, endFrame: 512, startValue: 0.5, endValue: 0 },
        ]);
        for (let block = 0; block < 4; block++) {
            renderBlock();
        }

        expect(paramDispatches).toEqual([
            { name: 'lid_position', value: 1, block: 0 },
            { name: 'lid_position', value: 0.75, block: 1 },
            { name: 'lid_position', value: 0.5, block: 2 },
            { name: 'lid_position', value: 0.25, block: 3 },
        ]);
    });

    it('applies and completes a zero-length microphone step at its render block', async () => {
        const strategy = await buildGrandBouleStrategy();
        const binding = strategy.resolveOfflineAutomation('micPosition');
        expect(binding?.kind).toBe('segments');
        if (!binding || binding.kind !== 'segments') {
            throw new Error('Grand Boule did not expose microphone automation to offline rendering');
        }

        binding.apply([{ startFrame: 0, endFrame: 0, startValue: 0, endValue: 2 }]);
        renderBlock();
        renderBlock();

        expect(paramDispatches).toEqual([{ name: 'mic_position', value: 2, block: 0 }]);
    });

    it('holds each discrete microphone value until the next automation tick', async () => {
        const strategy = await buildGrandBouleStrategy();
        const binding = strategy.resolveOfflineAutomation('micPosition');
        if (!binding || binding.kind !== 'segments') {
            throw new Error('Grand Boule did not expose microphone automation to offline rendering');
        }

        binding.apply([{ startFrame: 0, endFrame: 256, startValue: 0, endValue: 2 }]);
        renderBlock();
        renderBlock();
        renderBlock();

        expect(paramDispatches).toEqual([
            { name: 'mic_position', value: 0, block: 0 },
            { name: 'mic_position', value: 0, block: 1 },
            { name: 'mic_position', value: 2, block: 2 },
        ]);
    });

    it('applies frame-zero automation before voicing a frame-zero note', async () => {
        const strategy = await buildGrandBouleStrategy();
        const binding = strategy.resolveOfflineAutomation('lidPosition');
        if (!binding || binding.kind !== 'segments') {
            throw new Error('Grand Boule did not expose lid automation to offline rendering');
        }

        binding.apply([{ startFrame: 0, endFrame: 0, startValue: 0.25, endValue: 0.25 }]);
        schedulePendingSuspends(
            { sampleRate: OFFLINE_SAMPLE_RATE } as unknown as OfflineAudioContext,
            [noteOnEvent(0, 60, strategy)],
            4
        );
        renderBlock();

        expect(engineEvents).toEqual(['param:lid_position:0.25', 'note:60']);
    });

    it('applies automation before a note that shares a non-aligned frame inside the quantum', async () => {
        const strategy = await buildGrandBouleStrategy();
        const binding = strategy.resolveOfflineAutomation('lidPosition');
        if (!binding || binding.kind !== 'segments') {
            throw new Error('Grand Boule did not expose lid automation to offline rendering');
        }

        binding.apply([{ startFrame: 200, endFrame: 200, startValue: 0.4, endValue: 0.4 }]);
        schedulePendingSuspends(
            { sampleRate: OFFLINE_SAMPLE_RATE } as unknown as OfflineAudioContext,
            [noteOnEvent(0.2, 60, strategy)],
            4
        );
        renderBlock();
        renderBlock();

        expect(engineEvents).toEqual(['param:lid_position:0.4', 'note:60']);
    });

    it('leaves the current parameter untouched until a future clip lane starts', async () => {
        const strategy = await buildGrandBouleStrategy();
        const binding = strategy.resolveOfflineAutomation('lidPosition');
        if (!binding || binding.kind !== 'segments') {
            throw new Error('Grand Boule did not expose lid automation to offline rendering');
        }

        binding.apply([{ startFrame: 256, endFrame: 384, startValue: 0.75, endValue: 0.25 }]);
        renderBlock();
        renderBlock();
        expect(paramDispatches).toEqual([]);

        renderBlock();
        expect(paramDispatches).toEqual([{ name: 'lid_position', value: 0.75, block: 2 }]);
    });

    it('retains disjoint clip-lane schedules targeting the same parameter', async () => {
        const strategy = await buildGrandBouleStrategy();
        const binding = strategy.resolveOfflineAutomation('lidPosition');
        if (!binding || binding.kind !== 'segments') {
            throw new Error('Grand Boule did not expose lid automation to offline rendering');
        }

        binding.apply([{ startFrame: 0, endFrame: 128, startValue: 1, endValue: 0.5 }]);
        binding.apply([{ startFrame: 256, endFrame: 384, startValue: 0.5, endValue: 0 }]);
        for (let block = 0; block < 4; block++) {
            renderBlock();
        }

        expect(paramDispatches).toEqual([
            { name: 'lid_position', value: 1, block: 0 },
            { name: 'lid_position', value: 0.5, block: 1 },
            { name: 'lid_position', value: 0.5, block: 2 },
            { name: 'lid_position', value: 0, block: 3 },
        ]);
    });

    it('retires completed clip-lane schedules from per-quantum work', async () => {
        const strategy = await buildGrandBouleStrategy();
        const binding = strategy.resolveOfflineAutomation('lidPosition');
        if (!binding || binding.kind !== 'segments') {
            throw new Error('Grand Boule did not expose lid automation to offline rendering');
        }

        binding.apply([{ startFrame: 0, endFrame: 0, startValue: 0.5, endValue: 0.5 }]);
        expect(retainedAutomationScheduleCount()).toBe(1);

        renderBlock();
        expect(retainedAutomationScheduleCount()).toBe(0);
    });
});
