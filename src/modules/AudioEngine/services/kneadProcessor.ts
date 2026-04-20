// @ts-nocheck
/**
 * AudioWorkletProcessor for the Knead pitch editor.
 *
 * Manages the WASM KneadInstance and applies pitch shifts derived from
 * the current playback position and the active clip's NoteBlobs.
 */

import { initSync, KneadInstance } from '../wasm/daw_dsp.js';

class KneadProcessor extends AudioWorkletProcessor {
    _instance = null;
    _memory = null;
    _ready = false;
    _faulted = false;
    _bypassed = false;

    // Transport Synchronization
    _transportSAB = null;
    _transportView = null;

    // Track State (mapped by clipId)
    _clips = {};
    _activeClipId = null;

    constructor() {
        super();
        this.port.onmessage = (e) => {
            const msg = e.data;
            try {
                if (msg.type === 'init') {
                    this._initWasm(msg.wasmBytes, msg.transportSAB);
                } else if (msg.type === 'update-state') {
                    this._clips = msg.clips;
                } else if (msg.type === 'param' && this._ready) {
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

    _initWasm(wasmBytes, transportSAB) {
        const wasmExports = initSync({ module: new WebAssembly.Module(wasmBytes) });
        this._memory = wasmExports.memory;
        this._instance = new KneadInstance(sampleRate);
        this._transportSAB = transportSAB;
        if (transportSAB) {
            this._transportView = new Float64Array(transportSAB);
        }
        this._ready = true;
        this.port.postMessage({ type: 'ready' });
    }

    process(inputs, outputs) {
        const input = inputs[0];
        const output = outputs[0];

        if (!this._ready || this._faulted || !input || !output || input.length === 0 || output.length === 0) {
            if (input && output) {
                this._passthrough(input, output);
            }
            return true;
        }

        const frames = input[0].length;

        // 1. Resolve current temporal position
        let currentShiftSemitones = 0;
        if (this._transportView) {
            const v = this._transportView;
            const currentBeat = v[0];
            const tempo = v[1];
            const isPlaying = v[5] > 0.5;

            if (isPlaying) {
                // Find active clip
                let activeClip = null;
                for (const clipId in this._clips) {
                    const clip = this._clips[clipId];
                    if (currentBeat >= clip.startBeat && currentBeat <= clip.endBeat) {
                        activeClip = clip;
                        break;
                    }
                }

                if (activeClip) {
                    // Convert beat to clip-relative seconds
                    const songTimeSeconds = (currentBeat / tempo) * 60;
                    const clipStartTimeSeconds = (activeClip.startBeat / tempo) * 60;
                    const clipTimeSeconds = songTimeSeconds - clipStartTimeSeconds;

                    // Find active blob
                    const blob = activeClip.blobs.find(
                        (b) => clipTimeSeconds >= b.startTime && clipTimeSeconds <= b.endTime
                    );

                    if (blob) {
                        const centsDelta = blob.pitchCenterCents - blob.originalPitchCenterCents;
                        currentShiftSemitones = centsDelta / 100;
                    }
                }
            }
        }

        try {
            // Update shift dynamically
            this._instance.set_shift_semitones(currentShiftSemitones);

            const inputLeftPtr = this._instance.get_input_left_ptr();
            const inputRightPtr = this._instance.get_input_right_ptr();

            const mem = this._memory.buffer;
            const wasmInL = new Float32Array(mem, inputLeftPtr, frames);
            const wasmInR = new Float32Array(mem, inputRightPtr, frames);

            wasmInL.set(input[0]);
            if (input[1]) {
                wasmInR.set(input[1]);
            } else {
                wasmInR.set(input[0]);
            }

            // Call native process
            const resultPtr = this._instance.process(frames);

            const wasmOutL = new Float32Array(mem, resultPtr, frames);
            output[0].set(wasmOutL);
            if (output[1]) {
                output[1].set(wasmOutL);
            }
        } catch (error) {
            this._faulted = true;
            this.port.postMessage({ type: 'error', message: String(error) });
            this._passthrough(input, output);
        }

        return true;
    }

    _passthrough(input, output) {
        for (let ch = 0; ch < Math.min(input.length, output.length); ch++) {
            if (input[ch] && output[ch]) {
                output[ch].set(input[ch]);
            }
        }
    }
}

registerProcessor('knead-processor', KneadProcessor);
