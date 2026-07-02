import { type ModulationDependencies, dependencies } from './modulationDependencies';

export function getModulationDependencies(): ModulationDependencies {
    if (!dependencies) {
        throw new Error('Modulation dependencies not initialized');
    }
    return dependencies;
}
