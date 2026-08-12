import {
    adjustmentLayerStore,
    clipSelectionStore,
    markerStore,
    trackStore,
    vcaGroupStore,
} from '#/modules/Arrangement/stores';
import { getGlueEligibleClipPairs, getPlatformPlugins, getPluginById } from '#/modules/Arrangement/useCases';
import { automationStore } from '#/modules/Automation/stores';
import { midiStore } from '#/modules/MIDI/stores';
import { projectStore } from '#/modules/Project/stores';
import { sidechainStore } from '#/modules/Routing/stores';
import { transportStore } from '#/modules/Transport/stores';
import { workspaceStore } from '#/modules/WorkspaceShell/stores';
import { MIN_CLIP_LOOP_LENGTH_BEATS, projectClipLoopExpansion } from '#/utils/clipLoopProjection';

import { type ProjectContext } from '../models/ProjectContext';

export type {
    ProjectContext,
    ProjectContextAdjustmentLayer,
    ProjectContextAdjustmentRegion,
    ProjectContextAvailableDeviceType,
    ProjectContextAutomationLane,
    ProjectContextAutomationPoint,
    ProjectContextClip,
    ProjectContextDevice,
    ProjectContextDeviceParameter,
    ProjectContextSend,
    ProjectContextSection,
    ProjectContextSidechainRoute,
    ProjectContextTrack,
    ProjectContextVcaGroup,
} from '../models/ProjectContext';

// §92.2 — Memoize the context by the identity of the backing store
// values. Stores use immutable replacement (.set(new object)), so
// reference equality is enough: if all stores have the same identity as
// the last call, we can return the cached context without rebuilding
// the entire track/clip/device graph for the AI chat pipeline.
const contextCache: {
    track: unknown;
    adjustmentLayer: unknown;
    automation: unknown;
    transport: unknown;
    workspace: unknown;
    selection: unknown;
    midi: unknown;
    sidechain: unknown;
    marker: unknown;
    vca: unknown;
    project: unknown;
    glueEligibilitySignature: string;
    context: ProjectContext | null;
} = {
    track: null,
    adjustmentLayer: null,
    automation: null,
    transport: null,
    workspace: null,
    selection: null,
    midi: null,
    sidechain: null,
    marker: null,
    vca: null,
    project: null,
    glueEligibilitySignature: '',
    context: null,
};

export function getProjectContext(): ProjectContext {
    const trackState = trackStore.value;
    const adjustmentLayerState = adjustmentLayerStore.value;
    const automationState = automationStore.value;
    const transportState = transportStore.value;
    const workspaceState = workspaceStore.value;
    const selectionState = clipSelectionStore.value;
    // Read once per call instead of once per clip (§92.1). For a 100-track
    // project at ~20 clips each that's 2000 store dereferences → 1.
    const midiState = midiStore.value;
    const sidechainState = sidechainStore.value;
    const markerState = markerStore.value;
    const vcaState = vcaGroupStore.value;
    const projectState = projectStore.value;
    const notesByClipId = midiState?.notesByClipId;
    const glueEligibleClipPairs = getGlueEligibleClipPairs();
    const glueEligibilitySignature = JSON.stringify(glueEligibleClipPairs);

    if (
        contextCache.context !== null &&
        contextCache.track === trackState &&
        contextCache.adjustmentLayer === adjustmentLayerState &&
        contextCache.automation === automationState &&
        contextCache.transport === transportState &&
        contextCache.workspace === workspaceState &&
        contextCache.selection === selectionState &&
        contextCache.midi === midiState &&
        contextCache.sidechain === sidechainState &&
        contextCache.marker === markerState &&
        contextCache.vca === vcaState &&
        contextCache.project === projectState &&
        contextCache.glueEligibilitySignature === glueEligibilitySignature
    ) {
        return contextCache.context;
    }

    const selectedTrackId = trackState?.selectedTrackId ?? null;
    const selectedClipId = selectionState?.selectedClipId ?? null;
    const selectedClipIds = selectionState?.selectedClipIds ?? [];

    const built: ProjectContext = {
        ...(projectState ? { productionBrief: structuredClone(projectState.productionBrief) } : {}),
        tempo: transportState?.tempo ?? 120,
        timeSignature: [transportState?.timeSignatureNumerator ?? 4, transportState?.timeSignatureDenominator ?? 4],
        isPlaying: transportState?.isPlaying ?? false,
        isRecording: transportState?.isRecording ?? false,
        isLooping: transportState?.isLooping ?? false,
        loopStart: transportState?.loopStart ?? 0,
        loopEnd: transportState?.loopEnd ?? 0,
        punchInEnabled: transportState?.punchInEnabled ?? false,
        punchInBeat: transportState?.punchInBeat ?? 0,
        punchOutBeat: transportState?.punchOutBeat ?? 16,
        metronomeEnabled: transportState?.metronomeEnabled ?? false,
        metronomeVolume: transportState?.metronomeVolume ?? 0.5,
        masterGain: (transportState?.masterGain ?? 80) / 100,
        availableDeviceTypes: getPlatformPlugins()
            .filter((plugin) => plugin.id !== 'crust')
            .map((plugin) => ({ id: plugin.id, name: plugin.name })),
        adjustmentLayers: (adjustmentLayerState?.layers ?? []).map((layer) => ({
            id: layer.id,
            name: layer.name,
            effectType: layer.effectType,
            parameters: layer.parameters.map((parameter) => ({ ...parameter })),
            affectedTrackIds: [...layer.affectedTrackIds],
            insertionIndex: layer.insertionIndex,
            regions: layer.regions.map((region) => ({ ...region })),
            enabled: layer.enabled,
            mix: layer.mix,
            color: layer.color,
        })),
        automationLanes: (automationState?.lanes ?? []).map((lane) => ({
            id: lane.id,
            trackId: lane.trackId,
            ...(lane.clipId === undefined ? {} : { clipId: lane.clipId }),
            parameterId: lane.parameterId,
            name: lane.parameterName,
            enabled: lane.enabled,
            minValue: lane.minValue,
            maxValue: lane.maxValue,
            points: lane.points.map((point) => ({
                beat: point.beat,
                value: point.value,
                curve: point.curve,
            })),
        })),
        sidechainRoutes: (sidechainState?.routes ?? []).map((route) => ({
            id: route.id,
            sourceTrackId: route.sourceTrackId,
            targetTrackId: route.targetTrackId,
            targetDeviceId: route.targetDeviceId,
            targetParameterId: route.targetParameterId,
            gain: route.gain,
        })),
        sections: (markerState?.sections ?? []).map((section) => ({
            id: section.id,
            name: section.name,
            startBeat: section.startBeat,
            endBeat: section.endBeat,
        })),
        vcaGroups: (vcaState?.groups ?? []).map((group) => ({
            id: group.id,
            name: group.name,
            gain: group.gain,
            muted: group.muted,
            trackIds: [...group.trackIds],
        })),
        tracks: (trackState?.tracks ?? []).map((time) => ({
            id: time.id,
            name: time.name,
            kind: time.kind,
            muted: time.muted,
            soloed: time.soloed,
            soloSafe: time.soloSafe,
            armed: time.armed,
            frozen: time.frozen,
            gain: time.gain,
            pan: time.pan,
            automationMode: time.automationMode,
            vcaGroupId: time.vcaGroupId ?? null,
            outputId: time.outputId,
            clipCount: time.clips.length,
            alternativeClipIds: time.alternatives.flatMap((alternative) => alternative.clips.map((clip) => clip.id)),
            deviceCount: time.devices.length,
            clips: time.clips.map((context) => ({
                id: context.id,
                name: context.name,
                type: context.type,
                startBeat: context.startBeat,
                endBeat: context.endBeat,
                gain: context.gain,
                locked: context.locked,
                muted: context.muted,
                color: context.color,
                fadeInBeats: context.fadeInBeats,
                fadeOutBeats: context.fadeOutBeats,
                loopEnabled: context.loopEnabled ?? false,
                loopLength: context.loopLength,
                minimumLoopLengthBeats: projectClipLoopExpansion({
                    clipDurationBeats: context.endBeat - context.startBeat,
                    configuredLoopLengthBeats: MIN_CLIP_LOOP_LENGTH_BEATS,
                    loopEnabled: true,
                }).loopLengthBeats,
                noteCount: context.type === 'midi' ? (notesByClipId?.[context.id]?.length ?? 0) : 0,
            })),
            devices: time.devices.map((data) => {
                const descriptor = getPluginById(data.type);
                const parameters = (descriptor?.parameters ?? []).flatMap((parameter) => {
                    const value = data.parameterValues[parameter.id];
                    if (
                        typeof value !== 'number' ||
                        !Number.isFinite(value) ||
                        !Number.isFinite(parameter.minValue) ||
                        !Number.isFinite(parameter.maxValue)
                    ) {
                        return [];
                    }
                    return [
                        {
                            id: parameter.id,
                            name: parameter.name,
                            type: parameter.type,
                            value,
                            minValue: parameter.minValue,
                            maxValue: parameter.maxValue,
                            unit: parameter.unit,
                            ...(parameter.legalSet ? { legalValues: [...parameter.legalSet.values] } : {}),
                            ...(parameter.choices ? { choices: [...parameter.choices] } : {}),
                        },
                    ];
                });
                return {
                    id: data.id,
                    name: data.name,
                    type: data.type,
                    bypassed: data.bypassed,
                    parameters,
                };
            }),
            sends: time.sends.map((send) => ({
                busId: send.busId,
                level: send.level,
                preFader: send.preFader,
            })),
        })),
        selectedTrackId,
        selectedClipId,
        selectedClipIds,
        glueEligibleClipPairs,
        activeView: workspaceState?.mode ?? 'arrange',
        playheadPosition: transportState?.playheadPosition ?? 0,
    };

    contextCache.track = trackState;
    contextCache.adjustmentLayer = adjustmentLayerState;
    contextCache.automation = automationState;
    contextCache.transport = transportState;
    contextCache.workspace = workspaceState;
    contextCache.selection = selectionState;
    contextCache.midi = midiState;
    contextCache.sidechain = sidechainState;
    contextCache.marker = markerState;
    contextCache.vca = vcaState;
    contextCache.project = projectState;
    contextCache.glueEligibilitySignature = glueEligibilitySignature;
    contextCache.context = built;
    return built;
}
