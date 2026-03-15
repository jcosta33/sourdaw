class GainProcessor extends AudioWorkletProcessor {
    static get parameterDescriptors() {
        return [
            {
                name: "gain",
                defaultValue: 1.0,
                minValue: 0.0,
                maxValue: 1.0,
                automationRate: "a-rate",
            },
        ];
    }

    process(inputs, outputs, parameters) {
        const input = inputs[0];
        const output = outputs[0];

        if (!input || !input.length) {
            return true;
        }

        const gain = parameters.gain;
        const isConstant = gain.length === 1;

        for (let channel = 0; channel < output.length; channel++) {
            const inputChannel = input[channel];
            const outputChannel = output[channel];

            if (!inputChannel || !outputChannel) continue;

            for (let i = 0; i < outputChannel.length; i++) {
                const g = isConstant ? gain[0] : gain[i];
                outputChannel[i] = inputChannel[i] * g;
            }
        }

        return true;
    }
}

registerProcessor("gain-processor", GainProcessor);
