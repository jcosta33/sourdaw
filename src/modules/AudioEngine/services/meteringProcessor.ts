// @ts-nocheck
/// <reference lib="webworker" />
export class MeteringWorkletProcessor extends AudioWorkletProcessor {
    private _sab: Float32Array | null = null;
    private _channels = 1;

    constructor() {
        super();
        this.port.onmessage = (event) => {
            if (event.data.type === 'init') {
                this._sab = new Float32Array(event.data.sab);
                this._channels = event.data.channels ?? 1;
            }
        };
    }

    process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
        const input = inputs[0];
        if (!input || input.length === 0 || !this._sab) {
            return true;
        }

        // Pass-through audio so we can drop this right in the signal chain
        const output = outputs[0];
        if (output && output.length > 0) {
            for (let channel = 0; channel < input.length; channel++) {
                const inData = input[channel];
                const outData = output[channel];
                if (inData && outData) {
                    outData.set(inData);
                }
            }
        }

        // Calculate peak across all samples in the block
        let peak = 0;
        for (let channel = 0; channel < Math.min(input.length, this._channels); channel++) {
            const data = input[channel];
            if (data) {
                for (let index = 0; index < data.length; index++) {
                    const abs = Math.abs(data[index]!);
                    if (abs > peak) {
                        peak = abs;
                    }
                }
            }
        }

        // Write the peak to SAB (UI reads and resets to 0 periodically)
        // Using Math.max so we don't drop peaks between UI polling frames
        if (peak > this._sab[0]!) {
            this._sab[0] = peak;
        }

        return true;
    }
}

registerProcessor('metering-processor', MeteringWorkletProcessor);
