import { grinderNeuralModelJson } from '../models/GrinderNeuralModelJson';
import { DEFAULT_PATCH } from '../models/GrinderPatch';
import { applyGrinderProjectParameters } from '../models/GrinderProjectParameterMap';
import { grinderNeuralLibraryStore } from '../stores/grinderNeuralLibraryStore';

/** Resolve project identity at the owning boundary; snapshot every actual weight. */
export function captureNativeGrinderNeuralPatch(
    parameterValues: Readonly<Record<string, unknown>>
): Readonly<{ requestId: string; modelJson: string }> | undefined {
    if (typeof parameterValues.neuralModelMode !== 'number' || parameterValues.neuralModelMode <= 0.5) {
        return undefined;
    }
    const patch = applyGrinderProjectParameters(
        DEFAULT_PATCH,
        parameterValues,
        grinderNeuralLibraryStore.value?.entries ?? []
    );
    const profile = patch.neuralModelProfile;
    const carriesDigest = [0, 1, 2, 3].some(
        (index) => typeof parameterValues[`neuralCustomModelDigest${index}`] === 'number'
    );
    if (!profile?.modelDigest && !carriesDigest) {
        return undefined;
    }
    if (!profile?.model) {
        throw new Error('Imported Grinder NAM content is unavailable in the neural library');
    }
    const modelJson = grinderNeuralModelJson(profile.model);
    const matches =
        grinderNeuralLibraryStore.value?.entries.filter((entry) => entry.profile.modelDigest === profile.modelDigest) ??
        [];
    if (matches.some((entry) => !entry.profile.model || grinderNeuralModelJson(entry.profile.model) !== modelJson)) {
        throw new Error('Imported Grinder NAM identity is ambiguous in the neural library');
    }
    if (new TextEncoder().encode(modelJson).byteLength > 1_048_576) {
        throw new Error('Imported Grinder NAM exceeds the native model byte limit');
    }
    // Digest words only locate library content. Native SHA-256 authenticates
    // the exact serialized network; these hints are never a native cache key.
    return { requestId: crypto.randomUUID(), modelJson };
}
