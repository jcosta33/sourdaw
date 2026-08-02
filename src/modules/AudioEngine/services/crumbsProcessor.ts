/**
 * AudioWorkletProcessor for the Crumbs sampler/slicer engine.
 *
 * Uses the generated wasm-bindgen JS bindings (daw_dsp.js) via initSync, so all
 * WASM memory management is handled by the generated glue — no manual
 * malloc/free. Modelled on `levainProcessor`, which is the other sample-fed
 * instrument here.
 *
 * ## Samples arrive over the port, never off disk
 *
 * The native Crumbs host streams from disk through `crumbs::streaming`. Nothing
 * of that shape is possible here: an `AudioWorkletGlobalScope` exposes no
 * `fetch`, no `FileReader` and no filesystem, so a worklet cannot read anything
 * regardless of how the engine is built. The caller therefore decodes on the
 * main thread and transfers PCM in with `addSample`.
 *
 * That is the *correct* answer for rendering rather than a fallback: an
 * `OfflineAudioContext` renders as fast as it can and has no realtime deadline
 * to stream against, so a preloaded pool is strictly better than streaming
 * would be. The cost is a ceiling on total sample bytes, not on correctness.
 *
 * Messages from main thread:
 *   { type: 'init' } with `processorOptions.wasmModule`
 *   { type: 'loadSample', loadToken, data: Float32Array, channels, sampleRate }
 *   { type: 'noteOn', note, velocity, sampleFrame? }
 *   { type: 'noteOff', note, sampleFrame? }
 *   { type: 'allNotesOff' } | { type: 'allSoundOff' }
 *   { type: 'param', name, value }
 *   { type: 'mode', mode }
 *   { type: 'bypass', bypassed }
 *   { type: 'dispose' }
 */

import { resolveProcessorWasmModule } from '../transformers/resolveProcessorWasmModule';
import { CrumbsInstance, initSync } from '../wasm/daw_dsp.js';

import { WasmView } from './wasmView';

type CrumbsMsg =
    | { type: 'init' }
    | { type: 'loadSample'; loadToken: number; data: Float32Array; channels: number; sampleRate: number }
    | { type: 'noteOn'; note: number; velocity: number; sampleFrame?: number }
    | { type: 'noteOff'; note: number; sampleFrame?: number }
    | { type: 'allNotesOff' }
    | { type: 'allSoundOff' }
    | { type: 'param'; name: string; value: number }
    | { type: 'mode'; mode: string }
    | { type: 'bypass'; bypassed: boolean }
    | { type: 'dispose' };

type CrumbsQueued =
    | { type: 'noteOn'; note: number; velocity: number; sampleFrame: number }
    | { type: 'noteOff'; note: number; sampleFrame: number };

class CrumbsProcessor extends AudioWorkletProcessor {
    _instance: CrumbsInstance | null = null;
    _memory: WebAssembly.Memory | null = null;
    _ready = false;
    _faulted = false;
    _disposed = false;
    _bypassed = false;
    _pendingMessages: CrumbsMsg[] = [];
    _queue: CrumbsQueued[] = [];
    _queueHead = 0;
    // Cached WASM linear-memory views, revalidated on a memory.grow() buffer
    // identity change, so process() allocates nothing per render quantum.
    _outLeftView = new WasmView();
    _outRightView = new WasmView();

    constructor(...args: unknown[]) {
        super();
        let wasmModule = resolveProcessorWasmModule(args[0]);
        this.port.onmessage = (event: MessageEvent<CrumbsMsg>) => {
            const msg = event.data;
            try {
                if (msg.type === 'dispose') {
                    wasmModule = null;
                    this._dispose();
                } else if (this._disposed) {
                    return;
                } else if (msg.type === 'init') {
                    if (this._ready) {
                        return;
                    }
                    if (!wasmModule) {
                        throw new TypeError('CrumbsProcessor requires a compiled WASM module');
                    }
                    this._initWasm(wasmModule);
                    wasmModule = null;
                } else if (!this._ready) {
                    this._pendingMessages.push(msg);
                } else if (!this._faulted) {
                    this._handleMessage(msg);
                }
            } catch (error) {
                // Same policy as Levain's: a throw here is an OOM, a malformed
                // message or a trap left by an earlier panic, and those are not
                // distinguishable from this side. `addSample` copies whole
                // decoded samples through here, which is exactly where an OOM
                // lands. Treat the instance as unrecoverable and say so.
                console.error('CrumbsProcessor error:', error);
                this._faulted = true;
                this.port.postMessage({
                    type: 'error',
                    message: error instanceof Error ? error.message : String(error),
                });
            }
        };
    }

    _dispose(): void {
        if (this._disposed) {
            return;
        }
        this._disposed = true;
        this._ready = false;
        this._pendingMessages.length = 0;
        this._queue.length = 0;
        this._queueHead = 0;
        this._instance?.free();
        this._instance = null;
        this._memory = null;
        this.port.onmessage = null;
        this.port.postMessage({ type: 'disposed' });
    }

    _initWasm(wasmModule: WebAssembly.Module): void {
        const wasmExports = initSync({ module: wasmModule });
        this._memory = wasmExports.memory;
        this._instance = new CrumbsInstance(sampleRate);
        this._ready = true;

        for (const msg of this._pendingMessages) {
            this._handleMessage(msg);
        }
        this._pendingMessages = [];

        this.port.postMessage({ type: 'ready' });
    }

    _enqueue(msg: CrumbsQueued): void {
        let lo = this._queueHead;
        let hi = this._queue.length;
        while (lo < hi) {
            const mid = (lo + hi) >>> 1;
            const midMsg = this._queue[mid];
            if (midMsg && midMsg.sampleFrame <= msg.sampleFrame) {
                lo = mid + 1;
            } else {
                hi = mid;
            }
        }
        this._queue.splice(lo, 0, msg);
    }

    _handleMessage(msg: CrumbsMsg): void {
        if ((msg.type === 'noteOn' || msg.type === 'noteOff') && msg.sampleFrame !== undefined) {
            if (msg.sampleFrame > currentFrame) {
                this._enqueue({ ...msg, sampleFrame: msg.sampleFrame });
                return;
            }
        }
        this._dispatch(msg);
    }

    _dispatch(msg: CrumbsMsg | CrumbsQueued): void {
        const inst = this._instance;
        if (!inst) {
            return;
        }
        switch (msg.type) {
            case 'init':
                break;
            case 'loadSample': {
                try {
                    if (!Number.isSafeInteger(msg.loadToken) || msg.loadToken <= 0) {
                        throw new Error('Crumbs sample load token must be a positive safe integer');
                    }
                    // Pool and select in one step. The pool assigns the id, so
                    // splitting these across two messages would force the sender
                    // to await a reply for an id it has no other use for.
                    const sampleId = inst.add_sample(msg.data, msg.channels, msg.sampleRate);
                    inst.set_active_sample(sampleId);
                    this.port.postMessage({ type: 'sampleLoaded', loadToken: msg.loadToken });
                } catch (error) {
                    this.port.postMessage({
                        type: 'sampleLoadError',
                        loadToken: msg.loadToken,
                        message: error instanceof Error ? error.message : String(error),
                    });
                    throw error;
                }
                break;
            }
            case 'noteOn':
                inst.note_on(msg.note, msg.velocity);
                break;
            case 'noteOff':
                inst.note_off(msg.note);
                break;
            case 'allNotesOff':
                inst.all_notes_off();
                break;
            case 'allSoundOff':
                inst.all_sound_off();
                break;
            case 'param':
                inst.set_param(msg.name, msg.value);
                break;
            case 'mode':
                inst.set_mode(msg.mode);
                break;
            case 'bypass':
                this._bypassed = msg.bypassed;
                break;
            case 'dispose':
                break;
        }
    }

    _drainQueue(blockEndFrame: number): void {
        while (this._queueHead < this._queue.length) {
            const queued = this._queue[this._queueHead];
            if (!queued || queued.sampleFrame >= blockEndFrame) {
                break;
            }
            this._dispatch(queued);
            this._queueHead++;
        }
        if (this._queueHead >= this._queue.length) {
            this._queue.length = 0;
            this._queueHead = 0;
        }
    }

    process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
        if (this._disposed) {
            return false;
        }
        if (!this._ready || !this._instance || this._faulted || this._bypassed) {
            return true;
        }

        const output = outputs[0];
        if (!output || output.length < 2) {
            return true;
        }

        const out0 = output[0];
        if (!out0) {
            return true;
        }
        const frames = out0.length;
        const processFrames = Math.min(frames, 4096);

        this._drainQueue(currentFrame + frames);

        try {
            const inst = this._instance;
            const mem = this._memory?.buffer;
            if (!mem) {
                return true;
            }

            const leftPtr = inst.process(processFrames);
            const rightPtr = inst.get_right_ptr();

            // Re-read the live buffer AFTER process(): a Rust-side allocation
            // can grow linear memory mid-call and detach the previous buffer.
            const outMem = this._memory?.buffer ?? mem;

            out0.set(this._outLeftView.get(outMem, leftPtr, processFrames));
            const out1 = output[1];
            if (out1) {
                out1.set(this._outRightView.get(outMem, rightPtr, processFrames));
            }
        } catch (error) {
            this._faulted = true;
            this.port.postMessage({ type: 'error', message: String(error) });
        }

        return true;
    }
}

registerProcessor('crumbs-processor', CrumbsProcessor);
