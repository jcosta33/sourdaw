// @ts-nocheck
/**
 * AudioWorkletProcessor for native Rust DSP plugins (via WASM).
 *
 * Each processor instance hosts one WasmPluginInstance.
 * Receives param updates and init commands via MessagePort.
 */
import init, { WasmPluginInstance } from '../wasm/audio_core.js';

class NativeDspProcessor extends AudioWorkletProcessor {
    plugin = null;
    wasmMemory = null;
    isInitialized = false;

    constructor() {
        super();
        this.port.onmessage = async (e) => {
            const { type } = e.data;
            if (type === 'init') {
                try {
                    const wasm = await init(e.data.wasmUrl);
                    this.wasmMemory = wasm.memory;
                    this.plugin = new WasmPluginInstance(e.data.pluginType, sampleRate);
                    this.isInitialized = true;
                    this.port.postMessage({
                        type: 'ready',
                        paramNames: this.plugin.get_param_names(),
                    });
                } catch (err) {
                    console.error('NativeDspProcessor init failed:', err);
                    this.port.postMessage({ type: 'error', message: String(err) });
                }
            } else if (type === 'set_param' && this.plugin) {
                this.plugin.set_param(e.data.name, e.data.value);
            } else if (type === 'set_bypass' && this.plugin) {
                this.plugin.set_bypass(e.data.bypassed);
            }
        };
    }

    process(inputs, outputs, _parameters) {
        if (!this.isInitialized || !this.plugin || !this.wasmMemory) {
            return true;
        }

        const input = inputs[0];
        const output = outputs[0];
        if (!output || output.length < 2) {
            return true;
        }

        const frames = output[0].length;

        // Get input (or silence if no input connected)
        const inLeft = input && input[0] ? input[0] : new Float32Array(frames);
        const inRight = input && input[1] ? input[1] : inLeft;

        // Process through WASM
        const leftPtr = this.plugin.process_stereo(inLeft, inRight, frames);
        const rightPtr = this.plugin.get_right_ptr();

        // Map WASM memory to JS views
        const leftOut = new Float32Array(this.wasmMemory.buffer, leftPtr, frames);
        const rightOut = new Float32Array(this.wasmMemory.buffer, rightPtr, frames);

        // Copy to output
        output[0].set(leftOut);
        if (output[1]) {
            output[1].set(rightOut);
        }

        return true;
    }
}

registerProcessor('native-dsp-processor', NativeDspProcessor);
