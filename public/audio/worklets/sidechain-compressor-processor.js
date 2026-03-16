class SidechainCompressorProcessor extends AudioWorkletProcessor {
    static get parameterDescriptors() {
        return [
            { name: "threshold", defaultValue: -20, minValue: -60, maxValue: 0, automationRate: "k-rate" },
            { name: "ratio", defaultValue: 4, minValue: 1, maxValue: 20, automationRate: "k-rate" },
            { name: "attack", defaultValue: 0.01, minValue: 0.001, maxValue: 0.1, automationRate: "k-rate" },
            { name: "release", defaultValue: 0.1, minValue: 0.01, maxValue: 1, automationRate: "k-rate" },
            { name: "makeup", defaultValue: 0, minValue: 0, maxValue: 30, automationRate: "k-rate" },
        ];
    }

    constructor() {
        super();
        this._envelopeDb = 0;
    }

    process(inputs, outputs, parameters) {
        const mainInput = inputs[0];
        const scInput = inputs[1];
        const output = outputs[0];

        if (!mainInput || !mainInput.length || !output || !output.length) {
            return true;
        }

        const threshold = parameters.threshold[0];
        const ratio = parameters.ratio[0];
        const attack = parameters.attack[0];
        const release = parameters.release[0];
        const makeup = parameters.makeup[0];

        const blockSize = mainInput[0].length;
        const sampleRate = globalThis.sampleRate;

        const attackCoeff = 1 - Math.exp(-1 / (attack * sampleRate));
        const releaseCoeff = 1 - Math.exp(-1 / (release * sampleRate));

        const makeupLinear = Math.pow(10, makeup / 20);

        let rmsSum = 0;
        const hasSidechain = scInput && scInput.length > 0 && scInput[0] && scInput[0].length > 0;

        if (hasSidechain) {
            for (let ch = 0; ch < scInput.length; ch++) {
                const scChannel = scInput[ch];
                if (!scChannel) {
                    continue;
                }
                for (let i = 0; i < scChannel.length; i++) {
                    rmsSum += scChannel[i] * scChannel[i];
                }
            }
            rmsSum /= scInput.length * blockSize;
        }

        const rms = Math.sqrt(rmsSum);
        const scLevelDb = rms > 1e-10 ? 20 * Math.log10(rms) : -120;

        let targetReductionDb = 0;
        if (scLevelDb > threshold) {
            targetReductionDb = (scLevelDb - threshold) * (1 - 1 / ratio);
        }

        for (let i = 0; i < blockSize; i++) {
            if (targetReductionDb > this._envelopeDb) {
                this._envelopeDb += attackCoeff * (targetReductionDb - this._envelopeDb);
            } else {
                this._envelopeDb += releaseCoeff * (targetReductionDb - this._envelopeDb);
            }

            const gainLinear = Math.pow(10, -this._envelopeDb / 20) * makeupLinear;

            for (let ch = 0; ch < output.length; ch++) {
                const outCh = output[ch];
                const inCh = mainInput[ch] || mainInput[0];
                if (!outCh || !inCh) {
                    continue;
                }
                outCh[i] = inCh[i] * gainLinear;
            }
        }

        return true;
    }
}

registerProcessor("sidechain-compressor-processor", SidechainCompressorProcessor);
