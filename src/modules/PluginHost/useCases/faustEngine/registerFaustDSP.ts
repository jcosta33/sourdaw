import { type FaustModule, type FaustParamDescriptor } from '../../models/FaustEngineTypes';

import { faustEngineState } from './faustEngineState';

/**
 * The stored table has no runtime reader — only the shipped-DSP spec holds it
 * against the compiled node — so nothing downstream would ever notice a
 * malformed entry. The write site is the one place left to refuse it, and a
 * refusal here fails startup and CI instead of registering a table that only a
 * spec run far away can contradict.
 */
function validateParamDescriptors(name: string, params: readonly FaustParamDescriptor[]): void {
    const declared = new Set<string>();
    for (const [index, descriptor] of params.entries()) {
        const where = `${name} paramDescriptors[${index}] (${descriptor.address || 'no address'})`;
        if (!descriptor.address.startsWith('/')) {
            throw new Error(`${where}: address must be rooted at '/'`);
        }
        if (declared.has(descriptor.address)) {
            throw new Error(`${where}: address declared twice in one module`);
        }
        declared.add(descriptor.address);
        if (descriptor.min >= descriptor.max) {
            throw new Error(`${where}: min ${descriptor.min} must be below max ${descriptor.max}`);
        }
        if (descriptor.defaultValue < descriptor.min || descriptor.defaultValue > descriptor.max) {
            throw new Error(
                `${where}: defaultValue ${descriptor.defaultValue} lies outside ${descriptor.min}..${descriptor.max}`
            );
        }
        if (descriptor.step <= 0) {
            throw new Error(`${where}: step ${descriptor.step} must be positive`);
        }
    }
}

export function registerFaustDSP(
    name: string,
    dspCode: string,
    params: FaustParamDescriptor[] = [],
    isInstrument = false
): FaustModule {
    validateParamDescriptors(name, params);
    const module: FaustModule = {
        id: `faust-${name.toLowerCase().replaceAll(/\s+/g, '-')}`,
        name,
        dspCode,
        paramDescriptors: params,
        compiled: false,
        isInstrument,
        generator: null,
    };
    faustEngineState.modules.set(module.id, module);

    return module;
}
