import { selectGrinderNeuralModelContent } from '../models/GrinderNeuralModelContent';

import { grinderNeuralLibraryStore } from './grinderNeuralLibraryStore';

export function readGrinderNeuralModelContent(parameterValues: Readonly<Record<string, unknown>>): string | undefined {
    const entries = grinderNeuralLibraryStore.value?.entries ?? [];
    return selectGrinderNeuralModelContent(parameterValues, entries);
}
