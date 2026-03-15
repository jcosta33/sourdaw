class MeterProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this._updateInterval = 1024 / sampleRate;
        this._nextUpdate = this._updateInterval;
        this._peak = 0;
        this._rmsSum = 0;
        this._rmsCount = 0;
    }

    process(inputs) {
        const input = inputs[0];
        if (!input || !input.length) {
            return true;
        }

        for (let channel = 0; channel < input.length; channel++) {
            const samples = input[channel];
            if (!samples) continue;

            for (let i = 0; i < samples.length; i++) {
                const abs = Math.abs(samples[i]);
                if (abs > this._peak) {
                    this._peak = abs;
                }
                this._rmsSum += samples[i] * samples[i];
                this._rmsCount++;
            }
        }

        this._nextUpdate -= 128 / sampleRate;

        if (this._nextUpdate <= 0) {
            const rms = this._rmsCount > 0 ? Math.sqrt(this._rmsSum / this._rmsCount) : 0;

            this.port.postMessage({
                peak: this._peak,
                rms: rms,
            });

            this._peak = 0;
            this._rmsSum = 0;
            this._rmsCount = 0;
            this._nextUpdate = this._updateInterval;
        }

        return true;
    }
}

registerProcessor("meter-processor", MeterProcessor);
