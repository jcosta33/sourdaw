import { type FaustModule, type FaustParamDescriptor } from '../../models/FaustEngineTypes';
import { type WAMDescriptor } from '../wamPluginHost/hostOperations/helpers';
import { registerWAMPlugin } from '../wamPluginHost/hostOperations/registerWAMPlugin';

import { faustEngineState } from './faustEngineState';
import './registerFaustPluginLoader';

export function registerFaustDSP(
    name: string,
    dspCode: string,
    params: FaustParamDescriptor[] = [],
    isInstrument = false
): FaustModule {
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

    const descriptor: WAMDescriptor = {
        id: `faust.${module.id}`,
        name: `[Faust] ${name}`,
        vendor: 'Faust/Sourdaw',
        version: '1.0',
        category: isInstrument ? 'instrument' : 'effect',
        sdkVersion: '2.0',
        keywords: ['faust', 'dsp'],
    };
    registerWAMPlugin(descriptor);

    return module;
}
