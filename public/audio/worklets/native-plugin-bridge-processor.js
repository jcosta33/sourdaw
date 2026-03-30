/**
 * Native Plugin Bridge Processor — SharedArrayBuffer-based audio bridge.
 *
 * Connects the Web Audio graph to the Rust cpal audio thread via shared memory.
 * The worklet writes input audio to the SAB, the Rust thread reads it, processes
 * through the native plugin, and writes output back to the SAB. The worklet then
 * reads the processed output.
 *
 * Layout of SharedArrayBuffer (per instance):
 *   Offset 0:    Control word (Int32) — atomic flag
 *   Offset 4:    Input L  (128 x Float32 = 512 bytes)
 *   Offset 516:  Input R  (128 x Float32 = 512 bytes)
 *   Offset 1028: Output L (128 x Float32 = 512 bytes)
 *   Offset 1540: Output R (128 x Float32 = 512 bytes)
 *   Total: 2052 bytes
 *
 * Control word states:
 *   0 = idle (Rust can read input, process, write output)
 *   1 = input ready (worklet wrote input, waiting for Rust to process)
 *   2 = output ready (Rust wrote output, worklet can read)
 */

const CONTROL_OFFSET = 0;
const INPUT_L_OFFSET = 4;
const INPUT_R_OFFSET = 516;
const OUTPUT_L_OFFSET = 1028;
const OUTPUT_R_OFFSET = 1540;
const BLOCK_SIZE = 128;

const STATE_IDLE = 0;
const STATE_INPUT_READY = 1;
const STATE_OUTPUT_READY = 2;

class NativePluginBridgeProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.sab = null;
        this.controlView = null;
        this.inputL = null;
        this.inputR = null;
        this.outputL = null;
        this.outputR = null;
        this.ready = false;

        this.port.onmessage = (event) => {
            if (event.data.type === 'init' && event.data.sab instanceof SharedArrayBuffer) {
                this.sab = event.data.sab;
                this.controlView = new Int32Array(this.sab, CONTROL_OFFSET, 1);
                this.inputL = new Float32Array(this.sab, INPUT_L_OFFSET, BLOCK_SIZE);
                this.inputR = new Float32Array(this.sab, INPUT_R_OFFSET, BLOCK_SIZE);
                this.outputL = new Float32Array(this.sab, OUTPUT_L_OFFSET, BLOCK_SIZE);
                this.outputR = new Float32Array(this.sab, OUTPUT_R_OFFSET, BLOCK_SIZE);
                this.ready = true;
            }
        };
    }

    process(inputs, outputs) {
        if (!this.ready) {
            // Passthrough while not initialized
            const input = inputs[0];
            const output = outputs[0];
            if (input && output) {
                for (let ch = 0; ch < input.length; ch++) {
                    if (output[ch] && input[ch]) {
                        output[ch].set(input[ch]);
                    }
                }
            }
            return true;
        }

        const input = inputs[0];
        const output = outputs[0];
        if (!input || !output || input.length < 1) return true;

        const frames = Math.min(input[0].length, BLOCK_SIZE);

        // Read the previous block's output (if Rust has finished processing)
        const state = Atomics.load(this.controlView, 0);
        if (state === STATE_OUTPUT_READY) {
            // Rust finished processing — read output
            output[0].set(this.outputL.subarray(0, frames));
            if (output[1]) {
                output[1].set(this.outputR.subarray(0, frames));
            }
        } else {
            // Rust hasn't finished yet — passthrough (1 block latency on first block)
            for (let ch = 0; ch < input.length && ch < output.length; ch++) {
                output[ch].set(input[ch]);
            }
        }

        // Write current input for Rust to process next
        this.inputL.set(input[0].subarray(0, frames));
        if (input[1]) {
            this.inputR.set(input[1].subarray(0, frames));
        } else {
            this.inputR.set(input[0].subarray(0, frames)); // mono → stereo
        }

        // Signal input ready
        Atomics.store(this.controlView, 0, STATE_INPUT_READY);

        return true;
    }
}

registerProcessor('native-plugin-bridge-processor', NativePluginBridgeProcessor);
