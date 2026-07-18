import { dependencies, type PitchEditDependencies } from './pitchEditDependencies';

export function getPitchEditDependencies(): PitchEditDependencies {
    if (!dependencies) {
        throw new Error('Pitch edit dependencies not initialized');
    }

    return dependencies;
}
