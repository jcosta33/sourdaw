/**
 * AudioWorkletProcessor for the Knead pitch editor.
 *
 * Manages the WASM KneadInstance and applies pitch shifts derived from
 * the current playback position and the active clip's NoteBlobs.
 */

import { initSync, KneadInstance } from '../wasm/daw_dsp.js';

/** Extends KneadInstance with set_shift_semitones, which exists at runtime but is not yet exported in the WASM build declarations. */
type KneadInstanceWithShift = KneadInstance & { set_shift_semitones(semitones: number): void };

type KneadClipBlob = {
    startTime: number;
    endTime: number;
    pitchCenterCents: number;
    originalPitchCenterCents: number;
};

type KneadClip = {
    startBeat: number;
    endBeat: number;
    blobs: KneadClipBlob[];
};

type KneadMsg =
    | { type: 'init'; wasmBytes: BufferSource; transportSAB?: SharedArrayBuffer }
    | { type: 'update-state'; clips: Record<string, KneadClip> }
    | { type: 'param'; name: string; value: number }
    | { type: 'bypass'; bypassed: boolean };

// Transport SAB layout — kept in lockstep with the writer in
// repositories/createWebAudioEngine.ts (TRANSPORT_F64 / TRANSPORT_SEQ_I32).
// The seven f64 data fields are guarded by a seqlock counter in the Int32 view;
// the reader retries while the counter is odd (write in progress) or changes
// across the read, so it never consumes a snapshot torn across the field writes.
const TRANSPORT_BEAT_F64 = 0;
const TRANSPORT_TEMPO_F64 = 1;
const TRANSPORT_IS_PLAYING_F64 = 5;
const TRANSPORT_SEQ_I32 = 14;
// Bound the seqlock retry so a misbehaving writer can never hang the RT thread;
// on exhaustion the reader falls back to the (possibly torn, but bounded) last
// sample rather than spinning forever.
const TRANSPORT_SEQ_MAX_RETRIES = 8;

class KneadProcessor extends AudioWorkletProcessor {
    _instance: KneadInstanceWithShift | null = null;
    _memory: WebAssembly.Memory | null = null;
    _ready = false;
    _faulted = false;
    _bypassed = false;

    _transportSAB: SharedArrayBuffer | null = null;
    _transportView: Float64Array | null = null;
    _transportSeqView: Int32Array | null = null;

    _clips: Record<string, KneadClip> = {};

    constructor() {
        super();
        this.port.onmessage = (event: MessageEvent<KneadMsg>) => {
            const msg = event.data;
            try {
                if (msg.type === 'init') {
                    this._initWasm(msg.wasmBytes, msg.transportSAB ?? null);
                } else if (msg.type === 'update-state') {
                    this._clips = msg.clips;
                } else if (msg.type === 'param' && this._instance !== null && this._ready) {
                    if (msg.name === 'shift_semitones') {
                        this._instance.set_shift_semitones(msg.value);
                    }
                } else if (msg.type === 'bypass') {
                    this._bypassed = msg.bypassed;
                }
            } catch (error) {
                console.error('KneadProcessor error:', error);
                this.port.postMessage({ type: 'error', message: String(error) });
            }
        };
    }

    _initWasm(wasmBytes: BufferSource, transportSAB: SharedArrayBuffer | null): void {
        const wasmExports = initSync({ module: new WebAssembly.Module(wasmBytes) });
        this._memory = wasmExports.memory;
        this._instance = new KneadInstance(sampleRate) as KneadInstanceWithShift;
        this._transportSAB = transportSAB;
        if (transportSAB) {
            this._transportView = new Float64Array(transportSAB);
            this._transportSeqView = new Int32Array(transportSAB);
        }
        this._ready = true;
        this.port.postMessage({ type: 'ready' });
    }

    process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
        const input = inputs[0];
        const output = outputs[0];

        if (!this._ready || this._faulted || !input || !output || input.length === 0 || output.length === 0) {
            if (input && output) {
                this._passthrough(input, output);
            }
            return true;
        }

        const in0 = input[0];
        if (!in0) {
            return true;
        }
        const frames = in0.length;

        // Resolve current temporal position
        let currentShiftSemitones = 0;
        if (this._transportView && this._transportSeqView) {
            const view = this._transportView;
            const seq = this._transportSeqView;

            // Seqlock read: sample the three transport fields between two reads of
            // the sequence counter. If the counter was odd (a write was mid-flight)
            // or moved between the two reads, the snapshot is torn — retry. A bound
            // keeps the RT thread from spinning if the writer misbehaves.
            let currentBeat = 0;
            let tempo = 120;
            let isPlaying = false;
            for (let attempt = 0; attempt <= TRANSPORT_SEQ_MAX_RETRIES; attempt++) {
                const before = Atomics.load(seq, TRANSPORT_SEQ_I32);
                currentBeat = view[TRANSPORT_BEAT_F64] ?? 0;
                tempo = view[TRANSPORT_TEMPO_F64] ?? 120;
                isPlaying = (view[TRANSPORT_IS_PLAYING_F64] ?? 0) > 0.5;
                const after = Atomics.load(seq, TRANSPORT_SEQ_I32);
                if (before === after && (before & 1) === 0) {
                    break;
                }
            }

            if (isPlaying) {
                let activeClip: KneadClip | null = null;
                for (const clipId in this._clips) {
                    const clip = this._clips[clipId];
                    if (clip && currentBeat >= clip.startBeat && currentBeat <= clip.endBeat) {
                        activeClip = clip;
                        break;
                    }
                }

                if (activeClip) {
                    const songTimeSeconds = (currentBeat / tempo) * 60;
                    const clipStartTimeSeconds = (activeClip.startBeat / tempo) * 60;
                    const clipTimeSeconds = songTimeSeconds - clipStartTimeSeconds;

                    const blob = activeClip.blobs.find(
                        (b) => clipTimeSeconds >= b.startTime && clipTimeSeconds <= b.endTime
                    );

                    if (blob) {
                        // originalPitchCenterCents is absent from the persisted clip
                        // blob schema (Arrangement/Project forks), so after a project
                        // reload it rehydrates as undefined. A bare subtraction would
                        // yield NaN and silently corrupt the shift; fall back to the
                        // current center (zero shift) when the original is not finite.
                        const originalCents = blob.originalPitchCenterCents;
                        const baseCents = Number.isFinite(originalCents) ? originalCents : blob.pitchCenterCents;
                        const centsDelta = blob.pitchCenterCents - baseCents;
                        currentShiftSemitones = centsDelta / 100;
                    }
                }
            }
        }

        try {
            const inst = this._instance;
            const mem = this._memory?.buffer;
            if (!inst || !mem) {
                return true;
            }

            inst.set_shift_semitones(currentShiftSemitones);

            const inputLeftPtr = inst.get_input_left_ptr();
            const inputRightPtr = inst.get_input_right_ptr();

            const wasmInL = new Float32Array(mem, inputLeftPtr, frames);
            const wasmInR = new Float32Array(mem, inputRightPtr, frames);

            wasmInL.set(in0);
            wasmInR.set(input[1] ?? in0);

            const resultPtr = inst.process(frames);

            const wasmOutL = new Float32Array(mem, resultPtr, frames);
            const out0 = output[0];
            if (out0) {
                out0.set(wasmOutL);
            }
            const out1 = output[1];
            if (out1) {
                out1.set(wasmOutL);
            }
        } catch (error) {
            this._faulted = true;
            this.port.postMessage({ type: 'error', message: String(error) });
            this._passthrough(input, output);
        }

        return true;
    }

    _passthrough(input: Float32Array[], output: Float32Array[]): void {
        for (let ch = 0; ch < Math.min(input.length, output.length); ch++) {
            const inCh = input[ch];
            const outCh = output[ch];
            if (inCh && outCh) {
                outCh.set(inCh);
            }
        }
    }
}

registerProcessor('knead-processor', KneadProcessor);
