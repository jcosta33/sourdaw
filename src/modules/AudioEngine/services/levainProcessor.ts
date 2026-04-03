// @ts-nocheck
/**
 * AudioWorkletProcessor for the Levain suite engine.
 *
 * Uses the generated wasm-bindgen JS bindings (daw_dsp.js) via initSync so all
 * WASM memory management is handled by the generated glue — no manual malloc/free.
 *
 * Messages from main thread:
 *   { type: 'init', wasmBytes: ArrayBuffer }
 *   { type: 'noteOn', note, velocity, scheduleTime? }
 *   { type: 'noteOff', note, scheduleTime? }
 *   { type: 'param', name, value }
 *   { type: 'cc', cc, value }
 *   { type: 'bypass', bypassed }
 *   { type: 'addSample', sampleId, data, frameCount, channels, sampleRate }
 *   { type: 'addZone', ... }
 *   { type: 'buildZoneMap', numArticulations, numMics }
 *   { type: 'clearZones' }
 */

import { initSync, LevainInstance } from '../wasm/daw_dsp.js';

/**
 * Map TypeScript camelCase param names to Rust snake_case names
 * used by LevainEngine::set_param.
 */
const PARAM_MAP = {
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

class LevainProcessor extends AudioWorkletProcessor {
    _instance = null;   // LevainInstance (generated wasm-bindgen class)
    _memory = null;     // WebAssembly.Memory (for direct buffer access in process())
    _ready = false;
    _faulted = false;
    _bypassed = false;
    _pendingMessages = [];
    _queue = [];        // Sorted by scheduleTime (AudioContext seconds)

    constructor() {
        super();
        this.port.onmessage = (e) => {
            const msg = e.data;
            try {
                if (msg.type === 'init') {
                    if (this._ready) return;
                    this._initWasm(msg.wasmBytes);
                } else if (!this._ready) {
                    this._pendingMessages.push(msg);
                } else if (!this._faulted) {
                    this._handleMessage(msg);
                }
            } catch (err) {
                console.error('LevainProcessor error:', err);
                if (!this._ready) {
                    this.port.postMessage({ type: 'error', message: err?.message ?? String(err) });
                }
            }
        };
    }

    _initWasm(wasmBytes) {
        const wasmExports = initSync({ module: new WebAssembly.Module(wasmBytes) });
        this._memory = wasmExports.memory;
        this._instance = new LevainInstance(sampleRate, 64);
        this._ready = true;

        for (const msg of this._pendingMessages) {
            this._handleMessage(msg);
        }
        this._pendingMessages = [];

        this.port.postMessage({ type: 'ready' });
    }

    _enqueue(msg) {
        let lo = 0, hi = this._queue.length;
        while (lo < hi) {
            const mid = (lo + hi) >>> 1;
            if (this._queue[mid].scheduleTime <= msg.scheduleTime) lo = mid + 1;
            else hi = mid;
        }
        this._queue.splice(lo, 0, msg);
    }

    _handleMessage(msg) {
        if (msg.scheduleTime !== undefined && (msg.type === 'noteOn' || msg.type === 'noteOff')) {
            const now = currentFrame / sampleRate;
            if (msg.scheduleTime > now) {
                this._enqueue(msg);
                return;
            }
        }
        this._dispatch(msg);
    }

    _dispatch(msg) {
        const inst = this._instance;
        switch (msg.type) {
            case 'noteOn':
                inst.note_on(msg.note, msg.velocity);
                break;
            case 'noteOff':
                inst.note_off(msg.note);
                break;
            case 'param': {
                const rustName = PARAM_MAP[msg.name] ?? msg.name;
                inst.set_param(rustName, msg.value);
                break;
            }
            case 'cc':
                inst.handle_cc(msg.cc, msg.value);
                break;
            case 'bypass':
                this._bypassed = msg.bypassed;
                break;
            case 'addSample':
                inst.add_sample(msg.data, msg.frameCount, msg.channels, msg.sampleRate);
                break;
            case 'addZone': {
                const loopMode = msg.loopMode === 'forward' ? 1 : msg.loopMode === 'pingpong' ? 2 : 0;
                inst.add_zone(
                    msg.zoneId, msg.sampleId, msg.articulationId,
                    msg.rootNote, msg.loKey, msg.hiKey, msg.loVel, msg.hiVel,
                    msg.rrPos, msg.rrLen, msg.micId,
                    !!msg.isRelease, loopMode,
                    msg.loopStart, msg.loopEnd, msg.loopCrossfade,
                    msg.gainDb, msg.attack, msg.decay, msg.sustain, msg.release
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

    _drainQueue(blockEndTime) {
        while (this._queue.length > 0 && this._queue[0].scheduleTime <= blockEndTime) {
            this._dispatch(this._queue.shift());
        }
    }

    process(_inputs, outputs) {
        if (!this._ready || !this._instance || this._faulted || this._bypassed) return true;

        const output = outputs[0];
        if (!output || output.length < 2) return true;

        const frames = output[0].length;
        const processFrames = Math.min(frames, 4096);

        const blockEndTime = (currentFrame + frames) / sampleRate;
        this._drainQueue(blockEndTime);

        try {
            const leftPtr = this._instance.process(processFrames);
            const rightPtr = this._instance.get_right_ptr();

            const mem = this._memory.buffer;
            output[0].set(new Float32Array(mem, leftPtr, processFrames));
            if (output[1]) {
                output[1].set(new Float32Array(mem, rightPtr, processFrames));
            }
        } catch (err) {
            this._faulted = true;
            this.port.postMessage({ type: 'error', message: String(err) });
        }

        return true;
    }
}

registerProcessor('levain-processor', LevainProcessor);
