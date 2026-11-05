import { type NativeGrinderModel } from '../../models/AudioGraphBackend';

import { neuralModelContent } from './neuralModelContent';

export function captureNativeGrinderNeuralPatch(
    parameterValues: Readonly<Record<string, unknown>>
): NativeGrinderModel | undefined {
    const modelJson = neuralModelContent.read('captureNativeGrinderNeuralPatch').modelContent(parameterValues);
    if (modelJson === undefined) {
        return undefined;
    }
    if (new TextEncoder().encode(modelJson).byteLength > 1_048_576) {
        throw new Error('Imported Grinder NAM exceeds the native model byte limit');
    }
    // Digest words locate library content; native SHA-256 authenticates this exact snapshot.
    return { requestId: crypto.randomUUID(), modelJson };
}
