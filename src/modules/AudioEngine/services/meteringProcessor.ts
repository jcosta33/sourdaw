type MeteringMsg = { type: 'init'; sab: SharedArrayBuffer };

export class MeteringWorkletProcessor extends AudioWorkletProcessor {
    private _sab: Float32Array | null = null;

    constructor() {
        super();
        this.port.onmessage = (event: MessageEvent<MeteringMsg>) => {
            if (event.data.type === 'init') {
                this._sab = new Float32Array(event.data.sab);
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

        // Calculate the combined peak across every input channel in the block.
        // The SAB holds a single float, so this is a mono peak readout by design
        // (the consumer surface, getPeakLevel/getMasterPeakLevel, returns one
        // number). Scanning all present channels — rather than a caller-supplied
        // `channels` count against a 1-float buffer — means a hard-panned signal
        // is not under-reported by the meter.
        let peak = 0;
        for (let channel = 0; channel < input.length; channel++) {
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
