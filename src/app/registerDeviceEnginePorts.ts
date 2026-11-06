import { deviceFactoryPresetSources } from '#/modules/Arrangement/useCases';
import {
    builtinSynthVoice,
    engineAttachmentTracking,
    nativeBodyVocabularyRegistry,
    neuralModelContent,
} from '#/modules/AudioEngine/useCases';
import { readAttachedCrumbsInstanceIds } from '#/modules/Crumbs/stores';
import { markCrumbsEngineAttached, panicCrumbs, retractEveryCrumbsEngineAttachment } from '#/modules/Crumbs/useCases';
import {
    applyFermenterRuntimeParam,
    FERMENTER_PARAMS,
    getFermenterFactoryPresets,
    mapFermenterParamToDspParam,
    mapFermenterPatchToDspPatch,
} from '#/modules/Fermenter/useCases';
import { applyVelocityCurve, createGrandBouleStore } from '#/modules/GrandBoule/stores';
import { readGrinderNeuralModelContent } from '#/modules/Grinder/stores';
import { createLevainTemplateDeviceState, getLevainArticulationId } from '#/modules/Levain/useCases';
import { articulationIdResolvers, velocityCalibration } from '#/modules/MIDI/useCases';
import {
    rackProcessorReader,
    storedDrumVoices,
    templateArpeggiatorAuthoring,
    templateDeviceContent,
} from '#/modules/Project/useCases';
import {
    getDrumKitDefByIndex,
    getSynthParamsFromDevices,
    scheduleDrumKitNote,
    scheduleKitNote,
    scheduleNote,
    scheduleNoteOffline,
} from '#/modules/Synth/useCases';
import { toasterStore } from '#/modules/Toaster/stores';
import { getDefaultPadNames, getStoredDrumVoiceMetadata } from '#/modules/Toaster/useCases';
import {
    deviceRuntimeParameterWriters,
    kitSwing,
    liveMidiProcessor,
    notePanicParticipants,
} from '#/modules/Transport/useCases';
import { readYeastRack, setActiveYeastDevice } from '#/modules/Yeast/stores';
import { addYeastProcessor, processYeastMidi, setYeastProcessorParam, yeastPanic } from '#/modules/Yeast/useCases';

type DeviceEnginePorts = {
    nativeBodyVocabularies: Parameters<typeof nativeBodyVocabularyRegistry.configure>[0];
    runtimeParameterWriters: Parameters<typeof deviceRuntimeParameterWriters.configure>[0];
    factoryPresetSources: Parameters<typeof deviceFactoryPresetSources.configure>[0];
    liveMidiProcessor: Parameters<typeof liveMidiProcessor.configure>[0];
    notePanicParticipants: Parameters<typeof notePanicParticipants.configure>[0];
    kitSwing: Parameters<typeof kitSwing.configure>[0];
    engineAttachmentTracking: Parameters<typeof engineAttachmentTracking.configure>[0];
    neuralModelContent: Parameters<typeof neuralModelContent.configure>[0];
    velocityCalibration: Parameters<typeof velocityCalibration.configure>[0];
    articulationIdResolvers: Parameters<typeof articulationIdResolvers.configure>[0];
    rackProcessorReader: Parameters<typeof rackProcessorReader.configure>[0];
    templateArpeggiatorAuthoring: Parameters<typeof templateArpeggiatorAuthoring.configure>[0];
    templateDeviceContent: Parameters<typeof templateDeviceContent.configure>[0];
    storedDrumVoices: Parameters<typeof storedDrumVoices.configure>[0];
    builtinSynthVoice: Parameters<typeof builtinSynthVoice.configure>[0];
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
        liveMidiProcessor: {
            processBlock: processYeastMidi,
            readRackProcessors: (rackId) => readYeastRack(rackId).processors,
        },
        notePanicParticipants: {
            settleGeneratedNotes: yeastPanic,
            voiceReleases: [panicCrumbs],
        },
        kitSwing: {
            currentSwing: (deviceId) => toasterStore.value?.[deviceId]?.kit.swing,
        },
        engineAttachmentTracking: {
            markAttached: (instanceId) => markCrumbsEngineAttached({ instanceId }),
            readAttachedInstanceIds: readAttachedCrumbsInstanceIds,
            retractEveryAttachment: retractEveryCrumbsEngineAttachment,
        },
        neuralModelContent: { modelContent: readGrinderNeuralModelContent },
        velocityCalibration: {
            calibratedVelocity: (deviceId, velocity) => {
                const calibration = createGrandBouleStore(deviceId).value?.midiCalibration;
                return calibration ? applyVelocityCurve(velocity, calibration) : null;
            },
        },
        articulationIdResolvers: { levain: getLevainArticulationId },
        rackProcessorReader: {
            readProcessors: (deviceId) => readYeastRack(deviceId).processors,
        },
        templateArpeggiatorAuthoring: {
            focusRack: setActiveYeastDevice,
            addProcessor: addYeastProcessor,
            setProcessorParam: setYeastProcessorParam,
        },
        templateDeviceContent: {
            stringSectionState: createLevainTemplateDeviceState,
            defaultPadNames: getDefaultPadNames,
        },
        storedDrumVoices: { voicesOf: getStoredDrumVoiceMetadata },
        builtinSynthVoice: {
            scheduleNote,
            scheduleNoteOffline,
            scheduleKitNote,
            scheduleDrumKitNote,
            getDrumKitDefByIndex,
            getSynthParamsFromDevices,
        },
    };
}

/**
 * Engine and core modules may not import a device module, so the device
 * modules' parameter vocabularies, runtime writes, factory presets, MIDI
 * processing, note releases, live state, saved racks, template content,
 * stored kit voices and the built-in synth and drum synth voices reach them
 * through ports this composition root fills. Called by bootstrap and again
 * when `App` loads, because `main.tsx` loads the two independently and the
 * preset browser can render before bootstrap has run; registering the same
 * ports twice is a no-op.
 */
export function registerDeviceEnginePorts(): void {
    productionPorts ??= buildProductionPorts();
    nativeBodyVocabularyRegistry.configure(productionPorts.nativeBodyVocabularies);
    deviceRuntimeParameterWriters.configure(productionPorts.runtimeParameterWriters);
    deviceFactoryPresetSources.configure(productionPorts.factoryPresetSources);
    liveMidiProcessor.configure(productionPorts.liveMidiProcessor);
    notePanicParticipants.configure(productionPorts.notePanicParticipants);
    kitSwing.configure(productionPorts.kitSwing);
    engineAttachmentTracking.configure(productionPorts.engineAttachmentTracking);
    neuralModelContent.configure(productionPorts.neuralModelContent);
    velocityCalibration.configure(productionPorts.velocityCalibration);
    articulationIdResolvers.configure(productionPorts.articulationIdResolvers);
    rackProcessorReader.configure(productionPorts.rackProcessorReader);
    templateArpeggiatorAuthoring.configure(productionPorts.templateArpeggiatorAuthoring);
    templateDeviceContent.configure(productionPorts.templateDeviceContent);
    storedDrumVoices.configure(productionPorts.storedDrumVoices);
    builtinSynthVoice.configure(productionPorts.builtinSynthVoice);
}
