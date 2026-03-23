import { modulationSources, DEFAULT_MOD_PARAMS, type ModulationSourceType, type ModulationSource } from './types';

export function createModulationSource(type: ModulationSourceType, name?: string): ModulationSource {
    const defaultParams = DEFAULT_MOD_PARAMS[type] ?? {};

    const source: ModulationSource = {
        id: `mod-src-${crypto.randomUUID().slice(0, 8)}`,
        type,
        name: name ?? `${type.toUpperCase()} ${modulationSources.size + 1}`,
        parameters: { ...defaultParams },
    };
    modulationSources.set(source.id, source);
    return source;
}
