import { modulationSources, modulationStore } from './types';

/**
 * Update a single parameter on a modulation source (immutable via Store).
 */
export function updateModulationSourceParam(sourceId: string, param: string, value: number): void {
    const source = modulationSources.get(sourceId);
    if (!source) {
        return;
    }
    const current = modulationStore.value;
    if (!current) {
        return;
    }
    modulationStore.set({
        ...current,
        sources: {
            ...current.sources,
            [sourceId]: {
                ...source,
                parameters: { ...source.parameters, [param]: value },
            },
        },
    });
}
