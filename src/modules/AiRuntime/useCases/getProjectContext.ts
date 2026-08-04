import { clipSelectionStore, trackStore } from '#/modules/Arrangement/stores';
import { getPlatformPlugins, getPluginById } from '#/modules/Arrangement/useCases';
import { automationStore } from '#/modules/Automation/stores';
import { midiStore } from '#/modules/MIDI/stores';
import { sidechainStore } from '#/modules/Routing/stores';
import { transportStore } from '#/modules/Transport/stores';
import { workspaceStore } from '#/modules/WorkspaceShell/stores';

import { type ProjectContext } from '../models/ProjectContext';

export type {
    ProjectContext,
    ProjectContextAvailableDeviceType,
    ProjectContextAutomationLane,
    ProjectContextAutomationPoint,
    ProjectContextClip,
    ProjectContextDevice,
    ProjectContextDeviceParameter,
    ProjectContextSend,
    ProjectContextSidechainRoute,
    ProjectContextTrack,
} from '../models/ProjectContext';

// §92.2 — Memoize the context by the identity of the backing store
// values. Stores use immutable replacement (.set(new object)), so
// reference equality is enough: if all stores have the same identity as
// the last call, we can return the cached context without rebuilding
// the entire track/clip/device graph for the AI chat pipeline.
const contextCache: {
    track: unknown;
    automation: unknown;
    transport: unknown;
    workspace: unknown;
    selection: unknown;
    midi: unknown;
    sidechain: unknown;
    context: ProjectContext | null;
} = {
    track: null,
    automation: null,
    transport: null,
    workspace: null,
    selection: null,
    midi: null,
    sidechain: null,
    context: null,
};

export function getProjectContext(): ProjectContext {
    const trackState = trackStore.value;
    const automationState = automationStore.value;
    const transportState = transportStore.value;
    const workspaceState = workspaceStore.value;
    const selectionState = clipSelectionStore.value;
    // Read once per call instead of once per clip (§92.1). For a 100-track
    // project at ~20 clips each that's 2000 store dereferences → 1.
    const midiState = midiStore.value;
    const sidechainState = sidechainStore.value;
    const notesByClipId = midiState?.notesByClipId;

    if (
        contextCache.context !== null &&
        contextCache.track === trackState &&
        contextCache.automation === automationState &&
        contextCache.transport === transportState &&
        contextCache.workspace === workspaceState &&
        contextCache.selection === selectionState &&
        contextCache.midi === midiState &&
        contextCache.sidechain === sidechainState
    ) {
        return contextCache.context;
    }

    const selectedTrackId = trackState?.selectedTrackId ?? null;
    const selectedClipId = selectionState?.selectedClipId ?? null;
    const selectedClipIds = selectionState?.selectedClipIds ?? [];

    const built: ProjectContext = {
        tempo: transportState?.tempo ?? 120,
        timeSignature: [transportState?.timeSignatureNumerator ?? 4, transportState?.timeSignatureDenominator ?? 4],
        isLooping: transportState?.isLooping ?? false,
        loopStart: transportState?.loopStart ?? 0,
        loopEnd: transportState?.loopEnd ?? 0,
        metronomeEnabled: transportState?.metronomeEnabled ?? false,
        metronomeVolume: transportState?.metronomeVolume ?? 0.5,
        masterGain: (transportState?.masterGain ?? 80) / 100,
        availableDeviceTypes: getPlatformPlugins()
            .filter((plugin) => plugin.id !== 'crust')
            .map((plugin) => ({ id: plugin.id, name: plugin.name })),
        automationLanes: (automationState?.lanes ?? [])
            .filter((lane) => lane.clipId === undefined)
            .map((lane) => ({
                id: lane.id,
                trackId: lane.trackId,
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
        tracks: (trackState?.tracks ?? []).map((time) => ({
            id: time.id,
            name: time.name,
            kind: time.kind,
            muted: time.muted,
            soloed: time.soloed,
            soloSafe: time.soloSafe,
            armed: time.armed,
            gain: time.gain,
            pan: time.pan,
            automationMode: time.automationMode,
            outputId: time.outputId,
            clipCount: time.clips.length,
            deviceCount: time.devices.length,
            clips: time.clips.map((context) => ({
                id: context.id,
                name: context.name,
                type: context.type ?? 'audio',
                startBeat: context.startBeat,
                endBeat: context.endBeat,
                gain: context.gain,
                locked: context.locked,
                muted: context.muted,
                color: context.color,
                fadeInBeats: context.fadeInBeats,
                fadeOutBeats: context.fadeOutBeats,
                loopEnabled: context.loopEnabled ?? false,
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
                            ...(parameter.choices ? { choices: [...parameter.choices] } : {}),
                        },
                    ];
                });
                return {
                    id: data.id,
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
        activeView: workspaceState?.mode ?? 'arrange',
        playheadPosition: transportState?.playheadPosition ?? 0,
    };

    contextCache.track = trackState;
    contextCache.automation = automationState;
    contextCache.transport = transportState;
    contextCache.workspace = workspaceState;
    contextCache.selection = selectionState;
    contextCache.midi = midiState;
    contextCache.sidechain = sidechainState;
    contextCache.context = built;
    return built;
}
