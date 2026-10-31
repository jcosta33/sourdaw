import { resolveProcessorWasmModule } from '../transformers/resolveProcessorWasmModule';
import { initSync, TransientShaperInstance } from '../wasm/daw_dsp.js';

const RESET_FAULT_EPOCH = 16_777_215;

type GainName = 'attackGain' | 'sustainGain';
type ImmediateGain = { value: number; frame: number };
type ControlMessage = { type: string; epoch?: unknown; name?: unknown; value?: unknown; frame?: unknown };

function gainAtFrame(values: Float32Array | undefined, frame: number): number {
    return values?.[values.length === 1 ? 0 : frame] ?? Number.NaN;
}

/** A posted immediate write wins on its exact frame; every other frame reads the AudioParam. */
function gainForFrame(
    immediate: ImmediateGain,
    immediateIndex: number,
    values: Float32Array | undefined,
    frame: number
): number {
    return frame === immediateIndex ? immediate.value : gainAtFrame(values, frame);
}

function isGainName(name: unknown): name is GainName {
    return name === 'attackGain' || name === 'sustainGain';
}

function isNonNegativeInteger(value: unknown): value is number {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

class TransientShaperProcessor extends AudioWorkletProcessor {
    private instance: TransientShaperInstance | null = null;
    private disposed = false;
    private faulted = false;
    private resetEpoch = 0;
    // The host posts every bypass reset and immediate gain write here as well as
    // to its AudioParam. Chromium lands an AudioParam event at a `currentTime`
    // that sits above its integer frame one sample late (a k-rate one a whole
    // quantum late), so the frame a suspended context resumes on can only be
    // reached through the port: the idle worklet drains a message posted while
    // a live context is suspended before the quantum it resumes on.
    private pendingResetEpoch = 0;
    private readonly immediateGains: Record<GainName, ImmediateGain> = {
        attackGain: { value: 1, frame: -1 },
        sustainGain: { value: 1, frame: -1 },
    };

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
        this.port.onmessage = (event: MessageEvent<ControlMessage>) => {
            if (event.data.type === 'reset') {
                this.acceptReset(event.data.epoch);
                return;
            }
            if (event.data.type === 'gain') {
                this.acceptImmediateGain(event.data);
                return;
            }
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
        const epoch = Math.max(parameters._resetEpoch?.[0] ?? 0, this.pendingResetEpoch);
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

    private acceptReset(epoch: unknown): void {
        if (isNonNegativeInteger(epoch) && epoch > this.pendingResetEpoch) {
            this.pendingResetEpoch = epoch;
        }
    }

    private acceptImmediateGain({ name, value, frame }: ControlMessage): void {
        if (!isGainName(name) || typeof value !== 'number' || !Number.isFinite(value) || !isNonNegativeInteger(frame)) {
            return;
        }
        this.immediateGains[name].value = value;
        this.immediateGains[name].frame = frame;
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
        const immediateAttack = this.immediateGains.attackGain;
        const immediateSustain = this.immediateGains.sustainGain;
        const attackIndex = immediateAttack.frame - currentFrame;
        const sustainIndex = immediateSustain.frame - currentFrame;
        // Let unexpected WASM traps reach processorerror. The normal render
        // path creates no errors, messages, arrays or block-sized views.
        for (let frame = 0; frame < frames; frame++) {
            const attack = gainForFrame(immediateAttack, attackIndex, attackGain, frame);
            const sustain = gainForFrame(immediateSustain, sustainIndex, sustainGain, frame);
            if (left && frame < left.length) {
                left[frame] = instance.process_left(inLeft?.[frame] ?? 0, attack, sustain);
            }
            if (right && frame < right.length) {
                right[frame] = instance.process_right(inRight?.[frame] ?? 0, attack, sustain);
            }
        }
    }
}

registerProcessor('transient-shaper-processor', TransientShaperProcessor);
