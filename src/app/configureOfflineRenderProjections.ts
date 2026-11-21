import {
    acceptsExternalPluginAutomationParameter,
    clampDeviceParameterValue,
    clampExternalPluginAutomationValue,
    isDeviceParameterAutomatable,
    quantiseDeviceParameterValue,
} from '#/modules/Arrangement/useCases';
import {
    configureOfflineDeviceParameterLaw,
    configureOfflineMidiEventProjection,
    configureOfflinePpqEndpointProjection,
    configureOfflineYeastMidiProcessing,
} from '#/modules/AudioEngine/useCases';
import { createOfflineAutomationEvaluator, getAutomationValueAtBeat } from '#/modules/Automation/useCases';
import {
    createChordPitchProjector,
    createGrooveMidiEventProjector,
    projectChannelBend,
    projectClipControllerEvents,
    resolveMidiNoteArticulationId,
    shouldPlayMidiEvent,
} from '#/modules/MIDI/useCases';
import { externalPluginParameterStore } from '#/modules/PluginHost/stores';
import {
    beatAtSecondsFromAnchor,
    createMusicalPositionProjector,
    createSamplePositionProjector,
    projectPpqEndpoints,
    resolveTempoAtBeat,
} from '#/modules/Transport/useCases';
import {
    holdsKeyedYeastRack,
    holdsLegacyYeastRack,
    readStoredYeastRack,
    readYeastRack,
    yeastDeviceIdsInProjectOrder,
} from '#/modules/Yeast/stores';
import { createOfflineYeastMidiProcessor } from '#/modules/Yeast/useCases';

const createOfflineYeastProcessor: Parameters<typeof configureOfflineYeastMidiProcessing>[0]['createProcessor'] = (
    input
) => {
    const source = input?.source;
    return createOfflineYeastMidiProcessor({
        tracks: input?.tracks,
        processorsByDevice: source?.yeastProcessorsByDevice,
        grooveState: source?.grooveTemplates,
        resolveMusicalPosition: createMusicalPositionProjector(source),
        resolvePpqPosition: createSamplePositionProjector(source),
    });
};

/**
 * The offline render reaches MIDI, Automation, Transport, Yeast and the device
 * parameter law through these projections; only the composition root sees all
 * of them. Called by `bootstrapApplication`.
 */
export function configureOfflineRenderProjections(): void {
    configureOfflineMidiEventProjection({
        createProjector: createGrooveMidiEventProjector,
        selectProbability: shouldPlayMidiEvent,
        createChordPitchProjector,
        evaluateAutomationValue: getAutomationValueAtBeat,
        createAutomationValueEvaluator: createOfflineAutomationEvaluator,
        resolveArticulationId: resolveMidiNoteArticulationId,
        projectClipControllers: projectClipControllerEvents,
        projectChannelBend,
    });
    // The offline render and the native live automation producer enforce the same
    // device-parameter law the live apply path does; only the composition root sees
    // both Arrangement and the audio engine.
    configureOfflineDeviceParameterLaw({
        captureExternalPluginLaw: (source = externalPluginParameterStore.value) => {
            const state = structuredClone(source);
            return {
                acceptsExternalPluginParameter: (instanceId, parameterId) =>
                    acceptsExternalPluginAutomationParameter(instanceId, parameterId, state),
                clampExternalPluginValue: (input) => clampExternalPluginAutomationValue(input, state),
            };
        },
        isAutomatable: isDeviceParameterAutomatable,
        clampValue: clampDeviceParameterValue,
        quantiseValue: quantiseDeviceParameterValue,
        acceptsExternalPluginParameter: acceptsExternalPluginAutomationParameter,
        clampExternalPluginValue: clampExternalPluginAutomationValue,
    });
    configureOfflinePpqEndpointProjection({
        project: projectPpqEndpoints,
        resolveTempoAtBeat,
        beatAtSecondsFromAnchor,
    });
    configureOfflineYeastMidiProcessing({
        createProcessor: createOfflineYeastProcessor,
        racks: {
            readRack: (deviceId) => readYeastRack(deviceId).processors,
            readStoredRack: readStoredYeastRack,
            holdsKeyedRack: holdsKeyedYeastRack,
            holdsLegacyRack: holdsLegacyYeastRack,
            firstDeviceInProjectOrder: () => yeastDeviceIdsInProjectOrder()[0] ?? null,
        },
    });
}
