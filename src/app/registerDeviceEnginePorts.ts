import { deviceFactoryPresetSources } from '#/modules/Arrangement/useCases';
import { nativeBodyVocabularyRegistry } from '#/modules/AudioEngine/useCases';
import {
    applyFermenterRuntimeParam,
    FERMENTER_PARAMS,
    getFermenterFactoryPresets,
    mapFermenterParamToDspParam,
    mapFermenterPatchToDspPatch,
} from '#/modules/Fermenter/useCases';
import { deviceRuntimeParameterWriters } from '#/modules/Transport/useCases';

type DeviceEnginePorts = {
    nativeBodyVocabularies: Parameters<typeof nativeBodyVocabularyRegistry.configure>[0];
    runtimeParameterWriters: Parameters<typeof deviceRuntimeParameterWriters.configure>[0];
    factoryPresetSources: Parameters<typeof deviceFactoryPresetSources.configure>[0];
};

let productionPorts: DeviceEnginePorts | null = null;

function buildProductionPorts(): DeviceEnginePorts {
    // Macro slots (`macro0`..`macro7`) are deliberately absent: project truth
    // stores them as one `macros` array, not as individually keyed values, so
    // no lane parameter id ever resolves to one.
    const fermenterParamIds: ReadonlySet<string> = new Set(FERMENTER_PARAMS.map((param) => param.id));
    return {
        nativeBodyVocabularies: {
            fermenter: {
                parameterName: (paramId) => mapFermenterParamToDspParam({ paramId }),
                projectPatch: (values) => mapFermenterPatchToDspPatch({ patch: values }),
                addressesParameter: (paramId) => fermenterParamIds.has(paramId),
            },
        },
        runtimeParameterWriters: {
            fermenter: {
                write: applyFermenterRuntimeParam,
                engineParameterName: (paramId) => mapFermenterParamToDspParam({ paramId }),
            },
        },
        factoryPresetSources: [{ module: 'Fermenter', presets: getFermenterFactoryPresets }],
    };
}

/**
 * Engine and core modules may not import a device module, so the device
 * modules' parameter vocabularies, runtime writes and factory presets reach
 * them through ports this composition root fills. Called by bootstrap and again
 * when `App` loads, because `main.tsx` loads the two independently and the
 * preset browser can render before bootstrap has run; registering the same
 * ports twice is a no-op.
 */
export function registerDeviceEnginePorts(): void {
    productionPorts ??= buildProductionPorts();
    nativeBodyVocabularyRegistry.configure(productionPorts.nativeBodyVocabularies);
    deviceRuntimeParameterWriters.configure(productionPorts.runtimeParameterWriters);
    deviceFactoryPresetSources.configure(productionPorts.factoryPresetSources);
}
