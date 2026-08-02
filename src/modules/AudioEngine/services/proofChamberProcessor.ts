/**
 * AudioWorkletProcessor for the ProofChamber reverb (Dutch Oven).
 *
 * Uses the generated wasm-bindgen JS bindings (proof_chamber.js) via initSync so all
 * WASM memory management is handled by the generated glue — no manual malloc/free.
 *
 * Effect processor: reads from inputs[0], writes to outputs[0].
 *
 * Messages from main thread:
 *   { type: 'init' }
 *   { type: 'param', name, value }
 *   { type: 'bypass', bypassed }
 */

import { resolveProcessorWasmModule } from '../transformers/resolveProcessorWasmModule';
import { initSync, ProofChamberInstance } from '../wasm/proof_chamber.js';

import { WasmView } from './wasmView';

type ParamAutomationSegment = {
    startFrame: number;
    endFrame: number;
    startValue: number;
    endValue: number;
};

type ParamAutomationSchedule = {
    paramId: number;
    segments: ParamAutomationSegment[];
    segmentIndex: number;
    lastValue: number | undefined;
};

type ProofChamberMsg =
    | { type: 'init' }
    | { type: 'param'; name: string; value: number }
    | { type: 'paramAutomation'; paramId: number; segments: ParamAutomationSegment[] }
    | { type: 'bypass'; bypassed: boolean };

class ProofChamberProcessor extends AudioWorkletProcessor {
    _instance: ProofChamberInstance | null = null;
    _memory: WebAssembly.Memory | null = null;
    _ready = false;
    _faulted = false;
    _bypassed = false;
    _paramAutomation: ParamAutomationSchedule[] = [];
    // Cached WASM linear-memory views — reused across render quanta so process()
    // performs no per-block Float32Array allocation (audit RT-1); each revalidates
    // on a memory.grow() buffer-identity change (audit RT-7). See wasmView.ts.
    _outLeftView = new WasmView();
    _outRightView = new WasmView();

    constructor(...args: unknown[]) {
        super();
        let wasmModule = resolveProcessorWasmModule(args[0]);
        this.port.onmessage = (event: MessageEvent<ProofChamberMsg>) => {
            const msg = event.data;
            try {
                if (msg.type === 'init') {
                    if (this._ready) {
                        return;
                    }
                    if (!wasmModule) {
                        throw new TypeError('ProofChamberProcessor requires a compiled WASM module');
                    }
                    this._initWasm(wasmModule);
                    wasmModule = null;
                } else if (msg.type === 'bypass') {
                    this._bypassed = msg.bypassed;
                } else if (msg.type === 'paramAutomation' && this._instance !== null && !this._faulted) {
                    this._setParamAutomation(msg.paramId, msg.segments);
                } else if (msg.type === 'param' && this._instance !== null && !this._faulted) {
                    this._instance.set_param(msg.name, msg.value);
                }
            } catch (error) {
                // Same policy as the process() catch below. A throw at the wasm
                // boundary may leave the instance trapped, and a trap carries no
                // message, so it cannot be told apart from a recoverable error.
                // Reporting only while `!_ready` left a post-startup fault in a
                // worklet console, with the device still accepting work after.
                console.error('ProofChamberProcessor error:', error);
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
        this._instance = new ProofChamberInstance(sampleRate);
        this._ready = true;
        // Include the aligned convolution latency (GLOBAL_LATENCY = 128) so
        // the device registry can report it for host PDC — mirrors the
        // gluten/bacteria/proof handshake pattern.
        this.port.postMessage({ type: 'ready', latency: this._instance.get_latency() });
    }

    _setParamAutomation(paramId: number, segments: ParamAutomationSegment[]): void {
        if (!Number.isInteger(paramId) || paramId < 0 || paramId > 1 || segments.length === 0) {
            return;
        }
        const schedule: ParamAutomationSchedule = { paramId, segments, segmentIndex: 0, lastValue: undefined };
        const existingIndex = this._paramAutomation.findIndex((candidate) => candidate.paramId === paramId);
        if (existingIndex >= 0) {
            this._paramAutomation[existingIndex] = schedule;
        } else {
            this._paramAutomation.push(schedule);
        }
    }

    _applyParamAutomation(frame: number): void {
        const inst = this._instance;
        if (!inst) {
            return;
        }
        for (let scheduleIndex = 0; scheduleIndex < this._paramAutomation.length; scheduleIndex++) {
            const schedule = this._paramAutomation[scheduleIndex]!;
            while (
                schedule.segmentIndex < schedule.segments.length - 1 &&
                frame >= schedule.segments[schedule.segmentIndex]!.endFrame
            ) {
                schedule.segmentIndex++;
            }
            const segment = schedule.segments[schedule.segmentIndex]!;
            let value = segment.startValue;
            if (segment.endFrame <= segment.startFrame || frame >= segment.endFrame) {
                value = segment.endValue;
            } else if (frame > segment.startFrame) {
                const fraction = (frame - segment.startFrame) / (segment.endFrame - segment.startFrame);
                value = segment.startValue + (segment.endValue - segment.startValue) * fraction;
            }
            if (value !== schedule.lastValue) {
                inst.set_param_by_id(schedule.paramId, value);
                schedule.lastValue = value;
            }
        }
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

    process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
        const input = inputs[0];
        const output = outputs[0];

        if (!this._ready || this._bypassed || this._faulted) {
            if (input && output) {
                this._passthrough(input, output);
            }
            return true;
        }

        // Accept mono by duplicating input[0] to the right channel.
        // Previously this early-returned on `input.length < 2`, silently dropping
        // audio from any mono upstream.
        const leftIn = input?.[0];
        if (!leftIn || !output || output.length < 2) {
            return true;
        }
        const rightIn = input[1] ?? leftIn;
        const frames = leftIn.length;

        const out0 = output[0];
        const out1 = output[1];
        if (!out0 || !out1) {
            return true;
        }

        try {
            const inst = this._instance;
            const mem = this._memory?.buffer;
            if (!inst || !mem) {
                return true;
            }

            this._applyParamAutomation(currentFrame);

            const leftPtr = inst.process(leftIn, rightIn, frames);
            const rightPtr = inst.get_right_ptr();

            // Re-read the live buffer AFTER process(): a Rust-side allocation can
            // grow the linear memory mid-call and detach the previous buffer, so the
            // output views must map the post-grow buffer (audit RT-7). Steady state
            // leaves the identity unchanged and reuses the cached view.
            const outMem = this._memory?.buffer ?? mem;

            out0.set(this._outLeftView.get(outMem, leftPtr, frames));
            out1.set(this._outRightView.get(outMem, rightPtr, frames));
        } catch (error) {
            this._faulted = true;
            this.port.postMessage({ type: 'error', message: String(error) });
            this._passthrough(input, output);
        }

        return true;
    }
}

registerProcessor('proof-chamber-processor', ProofChamberProcessor);
