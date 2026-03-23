import { modulationSources, type ModulationSource } from './types';

export function getAllModulationSources(): ModulationSource[] {
    return [...modulationSources.values()];
}
