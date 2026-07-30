/**
 * AudioWorkletProcessor that *is* the Grand Boule engine, for offline rendering.
 *
 * This is a sibling of `grandBouleProcessor`, not a mode of it. That one is a
 * SharedArrayBuffer ring consumer whose `process()` copies published frames out
 * of a ring the engine Worker fills; this one owns a `GrandBouleInstance` and
 * renders the block itself. The two share no field and no line of `process()`,
 * and threading a flag through a single class would produce exactly the
 * which-branch-am-I-in bugs this change exists to close.
 *
 * ## Why offline gets its own transport
 *
 * An `OfflineAudioContext` has no system-level audio callback, so it has no load
 * value and no underrun (Web Audio §2.6), and §2.2 puts its rendering on "a
 * normal thread". A worklet that takes 20 ms to fill a 2.667 ms quantum offline
 * produces bit-identical audio and a slower render. The ring therefore protects
 * against a deadline that does not exist offline, while its `TARGET_AHEAD`
 * back-pressure and macrotask pacing are what starve an export into 97–99 %
 * silence (INVENTORY-device-clock-parity G-1). The consumer cannot even wait for
 * the producer: `Atomics.wait` is banned in `AudioWorkletGlobalScope`, and the
 * working group explicitly refused to relax that for the offline case.
 *
 * Live keeps the Worker and the ring. A Grand Boule overload there starves its
 * own ring and only Grand Boule drops out, which is worth having in a browser tab
 * where missing the graph deadline glitches every track.
 *
 * ## Clock
 *
 * One clock, no sync plane. `drainNoteQueue(currentFrame + frames)` with the
 * exclusive `>=` bound the sibling processors share. Offline this is *more*
 * accurate than live: every note is posted before `startRendering()`, so the
 * queue is fully populated at frame 0 and no anchor has to stand in for a
 * measurement that has not happened.
 *
 * Messages from the main thread:
 *   `processorOptions.wasmModule: WebAssembly.Module`
 *   → { type: 'ready' }
 *   every member of `GrandBouleDispatchMsg`
 */

import { type GrandBouleInstance } from '../wasm/daw_dsp.js';
import { resolveProcessorWasmModule } from '../services/resolveProcessorWasmModule';

import {
    createGrandBouleBlockViews,
    createGrandBouleInstance,
    createGrandBouleNoteQueue,
    receiveGrandBouleMessage,
    type GrandBouleDispatchMsg,
} from './grandBouleEngineCore';

/**
 * The Web Audio render quantum. Restated here rather than imported: worklet code
 * stays isolated from app modules, and `offlineRender/constants.ts` is one.
 */
const RENDER_QUANTUM_FRAMES = 128;

/** `GrandBouleInstance::process` pre-allocates this much; asking for more truncates. */
const MAX_BLOCK_FRAMES = 4096;

class GrandBouleOfflineProcessor extends AudioWorkletProcessor {
    _instance: GrandBouleInstance | null = null;
    _memory: WebAssembly.Memory | null = null;
    _ready = false;
    _faulted = false;
    _pendingMessages: GrandBouleDispatchMsg[] = [];
    _queue = createGrandBouleNoteQueue();
    // Cached WASM linear-memory views, revalidated on a memory.grow() buffer
    // identity change (audit RT-7). In steady state `update` performs four
    // primitive comparisons and allocates nothing.
    _blockViews = createGrandBouleBlockViews();

    constructor(options?: AudioWorkletNodeOptions) {
        super();
        this.port.onmessage = (event: MessageEvent<GrandBouleDispatchMsg>) => {
            const msg = event.data;
            try {
                if (!this._ready) {
                    this._pendingMessages.push(msg);
                } else if (!this._faulted) {
                    this._handleMessage(msg);
                }
            } catch (error) {
                // Same policy as Crumbs' and Levain's: a throw here is an OOM, a
                // malformed message or a trap left by an earlier panic, and
                // those are not distinguishable from this side. Treat the
                // instance as unrecoverable and say so, so `createGrandBouleNode`
                // rejects and `buildDeviceChain` reports a degraded device
                // rather than shipping an unannounced silent track.
                console.error('GrandBouleOfflineProcessor error:', error);
                this._faulted = true;
                this.port.postMessage({
                    type: 'error',
                    message: error instanceof Error ? error.message : String(error),
                });
            }
        };

        try {
            const wasmModule = resolveProcessorWasmModule(options);
            if (!wasmModule) {
                throw new Error('GrandBouleOfflineProcessor requires processorOptions.wasmModule');
            }
            this._initWasm(wasmModule);
        } catch (error) {
            console.error('GrandBouleOfflineProcessor init error:', error);
            this._faulted = true;
            this.port.postMessage({
                type: 'error',
                message: error instanceof Error ? error.message : String(error),
            });
        }
    }

    _initWasm(wasmModule: WebAssembly.Module): void {
        const engine = createGrandBouleInstance({ wasmModule, sampleRate });
        this._instance = engine.instance;
        this._memory = engine.memory;
        this._ready = true;

        for (const msg of this._pendingMessages) {
            this._handleMessage(msg);
        }
        this._pendingMessages = [];

        this.port.postMessage({ type: 'ready' });
    }

    _handleMessage(msg: GrandBouleDispatchMsg): void {
        const instance = this._instance;
        if (!instance) {
            return;
        }
        // `currentFrame` is the first frame of the quantum this worklet is about
        // to render, so this is the same quantity the Worker computes from its
        // ring write head plus the consumer offset. The shared core decides
        // enqueue-versus-voice from it, identically for both hosts.
        receiveGrandBouleMessage({
            instance,
            queue: this._queue,
            msg,
            blockEndFrame: currentFrame + RENDER_QUANTUM_FRAMES,
        });
    }

    process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
        const instance = this._instance;
        if (!this._ready || !instance || this._faulted) {
            return true;
        }

        const output = outputs[0];
        if (!output || output.length === 0) {
            return true;
        }

        const out0 = output[0];
        if (!out0) {
            return true;
        }
        const frames = out0.length;
        const processFrames = Math.min(frames, MAX_BLOCK_FRAMES);

        // Voice everything that belongs in the block about to be produced. The
        // engine has no sub-block note offset, so the block boundary is the only
        // place a note can be placed at all. Exclusive bound: a note landing
        // exactly on `currentFrame + frames` belongs to the next block.
        this._queue.drain(instance, currentFrame + frames);

        try {
            const mem = this._memory?.buffer;
            if (!mem) {
                return true;
            }

            const leftPtr = instance.process(processFrames);
            const rightPtr = instance.get_right_ptr();

            // Re-read the live buffer AFTER process(): a Rust-side allocation
            // can grow linear memory mid-call and detach the previous buffer.
            const outMem = this._memory?.buffer ?? mem;

            this._blockViews.update(outMem, leftPtr, rightPtr, processFrames);
            out0.set(this._blockViews.left);
            const out1 = output[1];
            if (out1) {
                out1.set(this._blockViews.right);
            }
        } catch (error) {
            this._faulted = true;
            this.port.postMessage({ type: 'error', message: String(error) });
        }

        return true;
    }
}

registerProcessor('grand-boule-offline-processor', GrandBouleOfflineProcessor);
