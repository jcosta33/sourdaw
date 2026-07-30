/**
 * AudioWorkletProcessor for the Levain suite engine.
 *
 * Uses the generated wasm-bindgen JS bindings (daw_dsp.js) via initSync so all
 * WASM memory management is handled by the generated glue — no manual malloc/free.
 *
 * Messages from main thread:
 *   { type: 'init' }
 *   { type: 'noteOn', note, velocity, sampleFrame? }
 *   { type: 'noteOff', note, sampleFrame? }
 *   { type: 'allNotesOff' }
 *   { type: 'param', name, value }
 *   { type: 'cc', cc, value }
 *   { type: 'bypass', bypassed }
 *   { type: 'addSample', sampleId, data, frameCount, channels, sampleRate }
 *   { type: 'addZone', ... }
 *   { type: 'buildZoneMap', numArticulations, numMics }
 *   { type: 'clearZones' }
 */

import { initSync, LevainInstance } from '../wasm/daw_dsp.js';

import { resolveProcessorWasmModule } from './resolveProcessorWasmModule';
import { WasmView } from './wasmView';

const PARAM_MAP: Record<string, string> = {
    masterGain: 'master_gain',
    humanize: 'humanize',
    legatoEnabled: 'legato_enabled',
    vibratoDepth: 'vibrato_depth',
    autoDivisi: 'auto_divisi',
    autoDivisiSize: 'auto_divisi_size',
    autoArticulation: 'auto_articulation',
    ensembleTiming: 'ensemble_timing',
    attackSpread: 'attack_spread',
    pitchConvergence: 'pitch_convergence',
};

type LevainAddZoneMsg = {
    type: 'addZone';
    zoneId: number;
    sampleId: number;
    articulationId: number;
    rootNote: number;
    loKey: number;
    hiKey: number;
    loVel: number;
    hiVel: number;
    rrPos: number;
    rrLen: number;
    micId: number;
    isRelease?: boolean;
    loopMode?: string;
    loopStart: number;
    loopEnd: number;
    loopCrossfade: number;
    gainDb: number;
    attack: number;
    decay: number;
    sustain: number;
    release: number;
};

/**
 * MPE per-note expression (audit MD-2). Values arrive already normalised to
 * engine units by `applyNoteExpression`, so the worklet only routes them.
 */
type NoteExpressionMsg = {
    type: 'noteExpression';
    note: number;
    channel: number;
    bendSemitones: number;
    pressure: number;
    slide: number;
    sampleFrame?: number;
};
type LevainMsg =
    | { type: 'init' }
    | { type: 'noteOn'; note: number; velocity: number; sampleFrame?: number; channel?: number }
    | { type: 'noteOff'; note: number; sampleFrame?: number; channel?: number }
    | NoteExpressionMsg
    | { type: 'allNotesOff' }
    | { type: 'param'; name: string; value: number }
    | { type: 'cc'; cc: number; value: number }
    | { type: 'setInstrument'; instrumentId: string }
    | { type: 'bypass'; bypassed: boolean }
    | { type: 'addSample'; data: Float32Array; frameCount: number; channels: number; sampleRate: number }
    | LevainAddZoneMsg
    | { type: 'buildZoneMap'; numArticulations: number; numMics: number }
    | { type: 'clearZones' };

type LevainQueued =
    | { type: 'noteOn'; note: number; velocity: number; sampleFrame: number; channel?: number }
    | { type: 'noteOff'; note: number; sampleFrame: number; channel?: number }
    | (NoteExpressionMsg & { sampleFrame: number });

class LevainProcessor extends AudioWorkletProcessor {
    _instance: LevainInstance | null = null;
    _memory: WebAssembly.Memory | null = null;
    _ready = false;
    _faulted = false;
    _bypassed = false;
    _pendingMessages: LevainMsg[] = [];
    _queue: LevainQueued[] = [];
    _queueHead = 0;
    // Cached WASM linear-memory views — reused across render quanta so process()
    // performs no per-block Float32Array allocation (audit RT-1); each revalidates
    // on a memory.grow() buffer-identity change (audit RT-7). See wasmView.ts.
    _outLeftView = new WasmView();
    _outRightView = new WasmView();

    constructor(...args: unknown[]) {
        super();
        let wasmModule = resolveProcessorWasmModule(args[0]);
        this.port.onmessage = (event: MessageEvent<LevainMsg>) => {
            const msg = event.data;
            try {
                if (msg.type === 'init') {
                    if (this._ready) {
                        return;
                    }
                    if (!wasmModule) {
                        throw new TypeError('LevainProcessor requires a compiled WASM module');
                    }
                    this._initWasm(wasmModule);
                    wasmModule = null;
                } else if (!this._ready) {
                    this._pendingMessages.push(msg);
                } else if (!this._faulted) {
                    this._handleMessage(msg);
                }
            } catch (error) {
                // Same policy as the process() catch below, deliberately.
                // A throw here is an OOM, a malformed message, or a wasm trap
                // left by an earlier panic — and a trap arrives with no message
                // at all, so the three are not distinguishable from this side.
                // Sample loading runs through here and copies hundreds of MiB
                // per instrument, which is exactly where an OOM lands. Treat
                // the instance as unrecoverable and say so: reporting only
                // while `!_ready` left a post-startup fault in a worklet
                // console, with the device still accepting work afterwards.
                console.error('LevainProcessor error:', error);
                this._faulted = true;
                this.port.postMessage({
                    type: 'error',
                    message: error instanceof Error ? error.message : String(error),
                });
            }
        };
    }

    _initWasm(wasmModule: WebAssembly.Module): void {
        const wasmExports = initSync({ module: wasmModule });
        this._memory = wasmExports.memory;
        this._instance = new LevainInstance(sampleRate, 64);
        this._ready = true;

        for (const msg of this._pendingMessages) {
            this._handleMessage(msg);
        }
        this._pendingMessages = [];

        this.port.postMessage({ type: 'ready' });
    }

    _enqueue(msg: LevainQueued): void {
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

    _handleMessage(msg: LevainMsg): void {
        if (
            (msg.type === 'noteOn' || msg.type === 'noteOff' || msg.type === 'noteExpression') &&
            msg.sampleFrame !== undefined &&
            msg.sampleFrame > currentFrame
        ) {
            this._enqueue({ ...msg, sampleFrame: msg.sampleFrame });
            return;
        }
        this._dispatch(msg);
    }

    _dispatch(msg: LevainMsg | LevainQueued): void {
        const inst = this._instance;
        if (!inst) {
            return;
        }
        switch (msg.type) {
            case 'init':
                break;
            case 'noteOn':
                inst.note_on_with_channel(msg.note, msg.velocity, msg.channel ?? 0);
                break;
            case 'noteOff':
                // Without a channel every voice at the pitch is released —
                // the historical behaviour channel-unaware callers rely on.
                if (msg.channel === undefined) {
                    inst.note_off(msg.note);
                } else {
                    inst.note_off_on_channel(msg.note, msg.channel);
                }
                break;
            case 'noteExpression':
                // MPE per-note expression (audit MD-2). Scheduled expression
                // carries the note's own start frame and is enqueued behind the
                // noteOn at that frame, so the voice exists before it is bent.
                inst.note_expression(msg.note, msg.channel, msg.bendSemitones, msg.pressure, msg.slide);
                break;
            case 'allNotesOff':
                inst.all_notes_off();
                break;
            case 'param': {
                const rustName = PARAM_MAP[msg.name] ?? msg.name;
                inst.set_param(rustName, msg.value);
                break;
            }
            case 'cc':
                inst.handle_cc(msg.cc, msg.value);
                break;
            case 'setInstrument':
                inst.set_instrument(msg.instrumentId);
                break;
            case 'bypass':
                this._bypassed = msg.bypassed;
                break;
            case 'addSample':
                inst.add_sample(msg.data, msg.frameCount, msg.channels, msg.sampleRate);
                break;
            case 'addZone': {
                const loopMode = (() => {
                    if (msg.loopMode === 'forward') {
                        return 1;
                    }
                    if (msg.loopMode === 'pingpong') {
                        return 2;
                    }
                    return 0;
                })();
                inst.add_zone(
                    msg.zoneId,
                    msg.sampleId,
                    msg.articulationId,
                    msg.rootNote,
                    msg.loKey,
                    msg.hiKey,
                    msg.loVel,
                    msg.hiVel,
                    msg.rrPos,
                    msg.rrLen,
                    msg.micId,
                    !!msg.isRelease,
                    loopMode,
                    msg.loopStart,
                    msg.loopEnd,
                    msg.loopCrossfade,
                    msg.gainDb,
                    msg.attack,
                    msg.decay,
                    msg.sustain,
                    msg.release
                );
                break;
            }
            case 'buildZoneMap':
                inst.build_zone_map(msg.numArticulations, msg.numMics);
                break;
            case 'clearZones':
                inst.clear_zones();
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

        const blockEndFrame = currentFrame + frames;
        this._drainQueue(blockEndFrame);

        try {
            const inst = this._instance;
            const mem = this._memory?.buffer;
            if (!mem) {
                return true;
            }

            const leftPtr = inst.process(processFrames);
            const rightPtr = inst.get_right_ptr();

            // Re-read the live buffer AFTER process(): a Rust-side allocation can
            // grow the linear memory mid-call and detach the previous buffer, so the
            // output views must map the post-grow buffer (audit RT-7). Steady state
            // leaves the identity unchanged and reuses the cached view.
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

registerProcessor('levain-processor', LevainProcessor);
