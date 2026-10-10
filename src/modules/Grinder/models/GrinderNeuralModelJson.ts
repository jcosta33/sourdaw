import { type GrinderNeuralModel } from './GrinderPatch';

/**
 * Serialize a validated model back to the `.nam` document shape the runtime
 * parses (#3774). The parser and the native runtime read exactly these keys —
 * architecture, optional version, optional root sample rate, config, weights —
 * so the round trip through `parseGrinderNamFile` → `GrinderNeuralModel` →
 * this text is lossless for everything the runtime executes, and the digest
 * over the model is unchanged by it.
 *
 * This is the transport that carries the model across the runtime patch door,
 * which speaks strings: the worklet hands the text to
 * `GrinderInstance::load_neural_model` verbatim.
 */
export function grinderNeuralModelJson(model: GrinderNeuralModel): string {
    const document: Record<string, unknown> = {
        architecture: model.architecture,
        config: model.config,
        weights: model.weights,
    };
    if (model.version !== null) {
        document.version = model.version;
    }
    if (model.sampleRate !== null) {
        document.sample_rate = model.sampleRate;
    }
    return JSON.stringify(document);
}
