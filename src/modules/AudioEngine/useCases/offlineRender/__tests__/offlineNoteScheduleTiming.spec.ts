import { describe, it, expect, vi, beforeEach } from 'vitest';

import { type LevainNodeResult } from '../../../engine/LevainNode';
import {
    NATIVE_DSP_DEVICE_FACTORIES,
    type NativeDspNode,
} from '../../../repositories/deviceStrategy/nativeDspDeviceFactories';
import { NativeDspDeviceStrategy } from '../../../repositories/deviceStrategy/NativeDspDeviceStrategy';
import {
    createGrowableMemory,
    installWorkletGlobals,
    makeChannels,
    RealFloat32Array,
    resetGrowableMemory,
    type GrowableMemory,
} from '../../../services/__tests__/wasmViewGrowthHarness';
import { schedulePendingSuspends } from '../schedulePendingSuspends';
import { type PendingWorkletEvent } from '../types';

// End-to-end timing proof for the offline note path, wired out of production
// parts only: the real factory table -> the real `NativeDspDeviceStrategy` ->
// the real `schedulePendingSuspends` -> the real `LevainProcessor`.
//
// Nothing here asserts a call *shape*. A projection that is wrong but
// self-consistent still passes an argument-shape assertion, which is exactly
// how the offline note surface stayed broken: `noteOn` was projected as
// Toaster's `(pad, velocity, midiNote?, sampleFrame?)` while Levain, Fermenter
// and Grand Boule really take `(note, velocity, sampleFrame?, channel?)`. All
// four slots are `number`, so the swap type-checked. What it destroyed was
// *when* the note sounds, so that is what this spec measures: a note scheduled
// for a later frame must not be dispatched to the engine until the render block
// that contains that frame.

const HEAP_BYTES = 64 * 1024;
const OUT_LEFT_PTR = 0;
const OUT_RIGHT_PTR = 4096;
const BLOCK_FRAMES = 128;

/** The offline context's rate. Deliberately small so frame numbers stay legible. */
const OFFLINE_SAMPLE_RATE = 1000;

const memory: GrowableMemory = createGrowableMemory(HEAP_BYTES);

/** Which render block was in flight when the engine actually voiced a note. */
let currentBlock = -1;

type Dispatch = { note: number; velocity: number; channel: number; block: number };
const dispatches: Dispatch[] = [];

class LevainInstanceMock {
    note_on(note: number, velocity: number): void {
        dispatches.push({ note, velocity, channel: 0, block: currentBlock });
    }
    note_on_with_channel(note: number, velocity: number, channel: number): void {
        dispatches.push({ note, velocity, channel, block: currentBlock });
    }
    note_off(_note: number): void {}
    note_off_on_channel(_note: number, _channel: number): void {}
    all_notes_off(): void {}
    set_param(_name: string, _value: number): void {}
    handle_cc(_cc: number, _value: number): void {}
    set_instrument(_id: string): void {}
    process(frames: number): number {
        const left = new RealFloat32Array(memory.buffer, OUT_LEFT_PTR, frames);
        const right = new RealFloat32Array(memory.buffer, OUT_RIGHT_PTR, frames);
        left.fill(0);
        right.fill(0);
        return OUT_LEFT_PTR;
    }
    get_right_ptr(): number {
        return OUT_RIGHT_PTR;
    }
}

vi.mock('../../../wasm/daw_dsp.js', () => ({
    initSync: vi.fn(() => ({ memory })),
    LevainInstance: LevainInstanceMock,
}));

// The port the stand-in Levain node writes to. Set once the processor exists.
const portHolder = vi.hoisted(() => ({ post: null as null | ((data: unknown) => void) }));

vi.mock('../../../engine/LevainNode', () => {
    // These two are typed from the real `LevainNodeResult`, so the stand-in
    // cannot drift away from the signature the production node actually
    // publishes (`LevainNode.ts`). Their bodies post the same messages the real
    // node posts.
    const noteOn: LevainNodeResult['noteOn'] = (note, velocity, sampleFrame, channel) => {
        portHolder.post?.({ type: 'noteOn', note, velocity, sampleFrame, channel });
    };
    const noteOff: LevainNodeResult['noteOff'] = (note, sampleFrame, channel) => {
        portHolder.post?.({ type: 'noteOff', note, sampleFrame, channel });
    };
    return {
        isLevainDevice: (deviceType: string) => deviceType === 'levain',
        createLevainNode: () =>
            Promise.resolve({
                workletNode: {} as AudioWorkletNode,
                ready: Promise.resolve({}),
                noteOn,
                noteOff,
            }),
    };
});

// The factory table imports every engine node at module load; stub the ones
// this spec does not drive so no real worklet/WASM module is pulled in.
vi.mock('../../../engine/FermenterNode', () => ({ isFermenterDevice: () => false, createFermenterNode: vi.fn() }));
vi.mock('../../../engine/ToasterNode', () => ({ isToasterDevice: () => false, createToasterNode: vi.fn() }));
vi.mock('../../../engine/GlutenNode', () => ({ isGlutenDevice: () => false, createGlutenNode: vi.fn() }));
vi.mock('../../../engine/BacteriaNode', () => ({ isBacteriaDevice: () => false, createBacteriaNode: vi.fn() }));
vi.mock('../../../engine/GrinderNode', () => ({ isGrinderDevice: () => false, createGrinderNode: vi.fn() }));
vi.mock('../../../engine/ProofNode', () => ({ isProofDevice: () => false, createProofNode: vi.fn() }));
vi.mock('../../../engine/ProofChamberNode', () => ({
    isProofChamberDevice: () => false,
    createProofChamberNode: vi.fn(),
}));
vi.mock('../../../engine/ScoringNode', () => ({ isScoringDevice: () => false, createScoringNode: vi.fn() }));
vi.mock('../../../engine/GrandBouleNode', () => ({ isGrandBouleDevice: () => false, createGrandBouleNode: vi.fn() }));
vi.mock('../../../engine/KneadNode', () => ({ isKneadDevice: () => false, createKneadNode: vi.fn() }));

type LevainProcessorLike = {
    port: { onmessage: ((event: { data: unknown }) => void) | null; postMessage: ReturnType<typeof vi.fn> };
    process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean;
};

const { registry } = installWorkletGlobals<LevainProcessorLike>();

const MINIMAL_WASM = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);

async function startProcessor(): Promise<LevainProcessorLike> {
    await import('../../../services/levainProcessor');
    const Ctor = registry.get('levain-processor');
    if (!Ctor) {
        throw new Error('levain-processor was not registered');
    }
    const processor = new Ctor({
        processorOptions: { wasmModule: new WebAssembly.Module(MINIMAL_WASM) },
    });
    processor.port.onmessage?.({ data: { type: 'init' } });
    expect(processor.port.postMessage).toHaveBeenCalledWith({ type: 'ready' });
    portHolder.post = (data) => processor.port.onmessage?.({ data });
    return processor;
}

/** Render one 128-frame block, advancing the worklet clock as the engine would. */
function renderBlock(processor: LevainProcessorLike): void {
    currentBlock += 1;
    vi.stubGlobal('currentFrame', currentBlock * BLOCK_FRAMES);
    processor.process([], [makeChannels(2, BLOCK_FRAMES)]);
}

async function buildLevainStrategy(): Promise<NativeDspDeviceStrategy> {
    const factory = NATIVE_DSP_DEVICE_FACTORIES.find((candidate) => candidate.matches('levain'));
    if (!factory) {
        throw new Error('no factory claims the levain device type');
    }
    const node: NativeDspNode = await factory.create({} as BaseAudioContext);
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

describe('offline note scheduling reaches the engine at the scheduled frame', () => {
    beforeEach(() => {
        resetGrowableMemory(memory, HEAP_BYTES);
        dispatches.length = 0;
        currentBlock = -1;
        vi.stubGlobal('currentFrame', 0);
    });

    it('holds each note until the render block that contains its frame', async () => {
        const processor = await startProcessor();
        const strategy = await buildLevainStrategy();
        const offlineCtx = { sampleRate: OFFLINE_SAMPLE_RATE } as unknown as OfflineAudioContext;

        schedulePendingSuspends(offlineCtx, [noteOnEvent(0.2, 60, strategy), noteOnEvent(0.5, 64, strategy)], 4);

        // Frames 200 and 500 are both in the future, so scheduling must voice
        // nothing yet — the processor queues them instead.
        expect(dispatches).toEqual([]);

        // Block b renders frames b*128 .. b*128+127. Frame 200 sits inside
        // block 1 (128..255) and frame 500 inside block 3 (384..511). Both are
        // strictly interior, so this assertion does not depend on how the
        // processor treats a frame that lands exactly on a block boundary.
        for (let block = 0; block < 4; block++) {
            renderBlock(processor);
        }

        expect(dispatches.map(({ note, block }) => ({ note, block }))).toEqual([
            { note: 60, block: 1 },
            { note: 64, block: 3 },
        ]);
    });

    it('does not hand the engine a frame number where an MPE channel belongs', async () => {
        const processor = await startProcessor();
        const strategy = await buildLevainStrategy();
        const offlineCtx = { sampleRate: OFFLINE_SAMPLE_RATE } as unknown as OfflineAudioContext;

        schedulePendingSuspends(offlineCtx, [noteOnEvent(0.2, 60, strategy)], 4);
        for (let block = 0; block < 2; block++) {
            renderBlock(processor);
        }

        // An offline part carries no per-note expression, so every voice belongs
        // on the base channel. `note_on_with_channel` takes a `u8`, so a frame
        // number here is truncated into a real member channel and the voice
        // becomes unreachable to channel-addressed release and expression.
        expect(dispatches).toEqual([{ note: 60, velocity: 90, channel: 0, block: 1 }]);
    });
});
