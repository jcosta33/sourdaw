import { resolveProcessorWasmModule } from '../transformers/resolveProcessorWasmModule';
import { initSync, TransientShaperInstance } from '../wasm/daw_dsp.js';

const RESET_FAULT_EPOCH = 16_777_215;

function gainAtFrame(values: Float32Array | undefined, frame: number): number {
    return values?.[values.length === 1 ? 0 : frame] ?? Number.NaN;
}

function sampleAtFrame(values: Float32Array | undefined, frame: number): number {
    return values?.[frame] ?? 0;
}

class TransientShaperProcessor extends AudioWorkletProcessor {
    private instance: TransientShaperInstance | null = null;
    private disposed = false;
    private faulted = false;
    private resetEpoch = 0;

    static get parameterDescriptors(): Array<{
        name: string;
        defaultValue: number;
        minValue: number;
        maxValue: number;
        automationRate: 'a-rate' | 'k-rate';
    }> {
        return [
            { name: 'attackGain', defaultValue: 1, minValue: 0, maxValue: 2, automationRate: 'a-rate' },
            { name: 'sustainGain', defaultValue: 1, minValue: 0, maxValue: 2, automationRate: 'a-rate' },
            {
                name: '_resetEpoch',
                defaultValue: 0,
                minValue: 0,
                maxValue: RESET_FAULT_EPOCH,
                automationRate: 'k-rate',
            },
        ];
    }

    constructor(...args: unknown[]) {
        super();
        let module = resolveProcessorWasmModule(args[0]);
        this.port.onmessage = (event: MessageEvent<{ type: string }>) => {
            if (event.data.type === 'dispose') {
                if (!this.disposed) {
                    this.disposed = true;
                    this.instance?.free();
                    this.instance = null;
                }
                this.port.postMessage({ type: 'disposed' });
                return;
            }
            if (this.disposed || this.faulted || event.data.type !== 'init' || this.instance) {
                return;
            }
            try {
                if (!module) {
                    throw new TypeError('Transient Shaper requires a compiled WASM module');
                }
                initSync({ module });
                module = null;
                this.instance = new TransientShaperInstance(sampleRate);
                this.port.postMessage({ type: 'ready', latency: 0 });
            } catch (error) {
                this.faulted = true;
                this.port.postMessage({ type: 'error', message: String(error) });
            }
        };
    }

    process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>): boolean {
        const output = outputs[0];
        const epoch = parameters._resetEpoch?.[0] ?? 0;
        if (epoch >= RESET_FAULT_EPOCH) {
            this.faulted = true;
        }
        const instance = this.instance;
        if (this.disposed || this.faulted || !instance) {
            if (output) {
                for (const channel of output) {
                    channel.fill(0);
                }
            }
            return !this.disposed && !this.faulted;
        }
        if (epoch !== this.resetEpoch) {
            instance.reset();
            this.resetEpoch = epoch;
        }
        this.render(instance, inputs, output, parameters);
        return true;
    }

    private render(
        instance: TransientShaperInstance,
        inputs: Float32Array[][],
        output: Float32Array[] | undefined,
        parameters: Record<string, Float32Array>
    ): void {
        const left = output?.[0];
        const right = output?.[1];
        const inLeft = inputs[0]?.[0];
        const inRight = inputs[0]?.[1] ?? inLeft;
        const attackGain = parameters.attackGain;
        const sustainGain = parameters.sustainGain;
        const frames = Math.max(left?.length ?? 0, right?.length ?? 0);
        // Let unexpected WASM traps reach processorerror. The normal render
        // path creates no errors, messages, arrays or block-sized views.
        for (let frame = 0; frame < frames; frame++) {
            const attack = gainAtFrame(attackGain, frame);
            const sustain = gainAtFrame(sustainGain, frame);
            if (left && frame < left.length) {
                left[frame] = instance.process_left(sampleAtFrame(inLeft, frame), attack, sustain);
            }
            if (right && frame < right.length) {
                right[frame] = instance.process_right(sampleAtFrame(inRight, frame), attack, sustain);
            }
        }
    }
}

registerProcessor('transient-shaper-processor', TransientShaperProcessor);
