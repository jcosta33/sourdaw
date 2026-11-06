import { grinderNeuralModelJson } from './GrinderNeuralModelJson';
import { DEFAULT_PATCH, type GrinderImportedNeuralModel } from './GrinderPatch';
import { applyGrinderProjectParameters } from './GrinderProjectParameterMap';

/** Read the selected library content without retaining its mutable model objects. */
export function selectGrinderNeuralModelContent(
    parameterValues: Readonly<Record<string, unknown>>,
    libraryEntries: readonly GrinderImportedNeuralModel[]
): string | undefined {
    if (typeof parameterValues.neuralModelMode !== 'number' || parameterValues.neuralModelMode <= 0.5) {
        return undefined;
    }
    const patch = applyGrinderProjectParameters(DEFAULT_PATCH, parameterValues, libraryEntries);
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
    const matches = libraryEntries.filter((entry) => entry.profile.modelDigest === profile.modelDigest);
    if (matches.some((entry) => !entry.profile.model || grinderNeuralModelJson(entry.profile.model) !== modelJson)) {
        throw new Error('Imported Grinder NAM identity is ambiguous in the neural library');
    }
    return modelJson;
}
