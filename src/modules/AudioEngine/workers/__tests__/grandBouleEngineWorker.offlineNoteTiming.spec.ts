import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { type GrandBouleNodeResult } from '../../engine/GrandBouleNode';
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
// engine worker.
//
// Grand Boule is the one instrument whose DSP does not live in the worklet: the
// worklet is a ring-buffer consumer and the WASM engine runs in a Web Worker.
// The worker had no note queue at all — every message voiced on receipt — and
// offline every message is posted before rendering starts, so a whole part
// collapsed onto the engine's first block.
//
// Nothing here asserts a call *shape*: a message that carries a `sampleFrame`
// field and ignores it passes a shape assertion. What is measured is *when* the
// engine is told to voice, expressed as the render block the worker was about to
// produce at the moment `note_on_with_channel` ran.

const BLOCK_FRAMES = 128;
/** Ring capacity in frames. Comfortably past the last frame these tests schedule. */
const RING_FRAMES = BLOCK_FRAMES * 32;
const RING_HEADER_BYTES = 2 * Int32Array.BYTES_PER_ELEMENT;
const WRITE_HEAD_IDX = 0;

/** The offline context's rate. Deliberately small so frame numbers stay legible. */
const OFFLINE_SAMPLE_RATE = 1000;

const ringSab = new SharedArrayBuffer(RING_HEADER_BYTES + RING_FRAMES * 2 * Float32Array.BYTES_PER_ELEMENT);
const ringControlInts = new Int32Array(ringSab, 0, 2);
const syncSab = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT);

/** A real `WebAssembly.Memory` the worker maps its rendered block out of. */
const wasmMemory = new WebAssembly.Memory({ initial: 1 });
const LEFT_PTR = 0;
const RIGHT_PTR = BLOCK_FRAMES * Float32Array.BYTES_PER_ELEMENT;

type Dispatch = { note: number; velocity: number; channel: number; block: number };
const dispatches: Dispatch[] = [];

/** Engine block index the worker is about to render, read off the live ring head. */
function pendingEngineBlock(): number {
    return Atomics.load(ringControlInts, WRITE_HEAD_IDX) / BLOCK_FRAMES;
}

class GrandBouleInstanceMock {
    note_on_with_channel(note: number, velocity: number, channel: number): void {
        dispatches.push({ note, velocity, channel, block: pendingEngineBlock() });
    }
    note_off(_note: number): void {}
    note_off_on_channel(_note: number, _channel: number): void {}
    note_expression(): void {}
    set_param(_name: string, _value: number): void {}
    set_sustain(_position: number): void {}
    set_una_corda(_engaged: boolean): void {}
    set_sostenuto(_engaged: boolean): void {}
    note_on_midi2(): void {}
    set_temperament(_index: number): void {}
    load_attack_clip(): void {}
    all_notes_off(): void {}
    process(_frames: number): number {
        return LEFT_PTR;
    }
    get_right_ptr(): number {
        return RIGHT_PTR;
    }
}

vi.mock('../../wasm/daw_dsp.js', () => ({
    initSync: vi.fn(() => ({ memory: wasmMemory })),
    GrandBouleInstance: GrandBouleInstanceMock,
}));

// The worker yields to its own event loop through a MessageChannel. Capture the
// callback instead of running it so each render tick is driven explicitly and
// the assertions stay deterministic.
const queuedYields: Array<() => void> = [];
vi.stubGlobal(
    'MessageChannel',
    class {
        port1 = { onmessage: null as ((event: MessageEvent) => void) | null };
        port2 = {
            postMessage: () => {
                const callback = this.port1.onmessage;
                if (callback) {
                    queuedYields.push(() => callback({ data: null } as MessageEvent));
                }
            },
        };
    }
);

const workerSelf = {
    onmessage: null as ((event: MessageEvent) => void) | null,
    postMessage: vi.fn(),
};
Object.defineProperty(globalThis, 'self', { configurable: true, value: workerSelf });

// The stand-in node posts exactly what the production node posts, and its two
// note methods are typed from the real `GrandBouleNodeResult`, so it cannot
// drift away from the signature `nativeDspDeviceFactories` binds against.
vi.mock('../../engine/GrandBouleNode', () => {
    const noteOn: GrandBouleNodeResult['noteOn'] = (midiNote, velocity, sampleFrame, channel) => {
        workerSelf.onmessage?.({ data: { type: 'noteOn', midiNote, velocity, sampleFrame, channel } } as MessageEvent);
    };
    const noteOff: GrandBouleNodeResult['noteOff'] = (midiNote, sampleFrame, releaseVelocity, channel) => {
        workerSelf.onmessage?.({
            data: { type: 'noteOff', midiNote, sampleFrame, releaseVelocity: releaseVelocity ?? 0, channel },
        } as MessageEvent);
    };
    return {
        isGrandBouleDevice: (deviceType: string) => deviceType === 'grand-boule',
        createGrandBouleNode: () =>
            Promise.resolve({ workletNode: {} as AudioWorkletNode, ready: Promise.resolve({}), noteOn, noteOff }),
    };
});

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

const MINIMAL_WASM = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);

async function startEngineWorker(): Promise<void> {
    await import('../grandBouleEngineWorker');
    // An offline render begins at context frame 0, so engine frame 0 is heard at
    // context frame 0 — the anchor the production node derives from
    // `ctx.currentTime` on an `OfflineAudioContext`.
    workerSelf.onmessage?.({
        data: {
            type: 'init',
            wasmBytes: MINIMAL_WASM,
            sab: ringSab,
            sampleRate: OFFLINE_SAMPLE_RATE,
            syncSab,
            contextFrame: 0,
        },
    } as MessageEvent);
}

/** Run the worker's pending render ticks until it stops scheduling more work. */
function pumpRenderTicks(maxTicks = 64): void {
    for (let tick = 0; tick < maxTicks; tick++) {
        const next = queuedYields.shift();
        if (!next) {
            return;
        }
        next();
    }
}

async function buildGrandBouleStrategy(): Promise<NativeDspDeviceStrategy> {
    const factory = NATIVE_DSP_DEVICE_FACTORIES.find((candidate) => candidate.matches('grand-boule'));
    if (!factory) {
        throw new Error('no factory claims the grand-boule device type');
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

describe('offline Grand Boule scheduling reaches the engine at the scheduled frame', () => {
    beforeEach(async () => {
        dispatches.length = 0;
        queuedYields.length = 0;
        new Float32Array(ringSab, RING_HEADER_BYTES).fill(0);
        await startEngineWorker();
    });

    afterEach(() => {
        workerSelf.onmessage?.({ data: { type: 'stop' } } as MessageEvent);
        queuedYields.length = 0;
    });

    it('holds each note until the engine block that contains its frame', async () => {
        const strategy = await buildGrandBouleStrategy();
        const offlineCtx = { sampleRate: OFFLINE_SAMPLE_RATE } as unknown as OfflineAudioContext;

        schedulePendingSuspends(offlineCtx, [noteOnEvent(0.2, 60, strategy), noteOnEvent(0.5, 64, strategy)], 4);

        // Nothing has been rendered yet, so frames 200 and 500 are both in the
        // future and scheduling must voice nothing — the worker queues them.
        expect({ dispatches, headBeforeRender: pendingEngineBlock() }).toEqual({
            dispatches: [],
            headBeforeRender: 0,
        });

        pumpRenderTicks();

        // Block b carries engine frames b*128 .. b*128+127. Frame 200 sits
        // inside block 1 (128..255) and frame 500 inside block 3 (384..511).
        // Both are strictly interior, so this does not depend on how the drain
        // treats a frame landing exactly on a block boundary.
        expect(dispatches.map(({ note, block }) => ({ note, block }))).toEqual([
            { note: 60, block: 1 },
            { note: 64, block: 3 },
        ]);
    });

    it('does not hand the engine a frame number where an MPE channel belongs', async () => {
        const strategy = await buildGrandBouleStrategy();
        const offlineCtx = { sampleRate: OFFLINE_SAMPLE_RATE } as unknown as OfflineAudioContext;

        schedulePendingSuspends(offlineCtx, [noteOnEvent(0.2, 60, strategy)], 4);
        pumpRenderTicks();

        // An offline part carries no per-note expression, so every voice belongs
        // on the base channel. `note_on_with_channel` takes a `u8`, so a frame
        // number here is truncated into a real member channel and the voice
        // becomes unreachable to channel-addressed release and expression.
        expect(dispatches).toEqual([{ note: 60, velocity: 90, channel: 0, block: 1 }]);
    });
});
