import { takeLaneStore, timelineEditingStore } from '#/modules/Arrangement/stores';
import { modulationStore } from '#/modules/Automation/stores';
import { midiStore } from '#/modules/MIDI/stores';
import { type AppActionType } from '#/utils/handlerContract';

import {
    dynamicEffectProofKindByActionType,
    type DynamicEffectProofKind,
} from '../models/DynamicEffectProofKindByActionType';
import { type ProjectContext } from '../models/ProjectContext';

/** What one command is proven to touch; provers write into it in the order they discover ids. */
export type DynamicCommandEffects = {
    readonly affectedTrackIds: Set<string>;
    readonly affectedClipIds: Set<string>;
    readonly affectedTargetIds: Set<string>;
    automationPoints: number;
    deletedObjects: number;
};

type DynamicCommandEffectProofInput = {
    readonly actionType: AppActionType;
    readonly context: ProjectContext;
    readonly payload: unknown;
    readonly protectedTargetIds: readonly string[] | undefined;
    readonly effects: DynamicCommandEffects;
};

type DynamicCommandEffectProver = (input: DynamicCommandEffectProofInput) => void;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getStringField(value: unknown, key: string): string | undefined {
    if (!isRecord(value)) {
        return undefined;
    }
    const field = value[key];
    return typeof field === 'string' ? field : undefined;
}

function orEmpty<Value>(values: readonly Value[] | undefined): readonly Value[] {
    if (!values) {
        return [];
    }
    return values;
}

function readClipMidiEvents(clipId: string): readonly { readonly id: string }[] {
    const midiState = midiStore.value;
    return [
        ...orEmpty(midiState?.notesByClipId[clipId]),
        ...orEmpty(midiState?.ccByClipId[clipId]),
        ...orEmpty(midiState?.pitchBendByClipId[clipId]),
    ];
}

/** Commands whose effects the compiled envelope already states fully. */
function proveNoDynamicEffects(): void {}

function proveClearSolos(input: DynamicCommandEffectProofInput): void {
    for (const track of input.context.tracks) {
        if (track.soloed) {
            input.effects.affectedTrackIds.add(track.id);
        }
    }
}

function proveDuplicateClip(input: DynamicCommandEffectProofInput): void {
    const { context, payload, effects } = input;
    const sourceClipId = getStringField(payload, 'clipId');
    const targetClipId = getStringField(payload, 'targetClipId');
    const owner = context.tracks.find((track) => track.clips.some((clip) => clip.id === sourceClipId));
    if (!sourceClipId || !targetClipId || !owner) {
        throw new Error(`Cannot prove duplicate clip bounds for ${sourceClipId ?? 'unknown clip'}`);
    }
    effects.affectedTrackIds.add(owner.id);
    effects.affectedClipIds.add(sourceClipId);
    effects.affectedClipIds.add(targetClipId);
    for (const lane of context.automationLanes ?? []) {
        if (lane.clipId === sourceClipId) {
            effects.automationPoints += lane.points.length;
        }
    }
}

function proveDuplicateTrack(input: DynamicCommandEffectProofInput): void {
    const { context, payload, effects } = input;
    const sourceTrackId = getStringField(payload, 'trackId');
    const targetTrackId = getStringField(payload, 'targetTrackId');
    const source = context.tracks.find((track) => track.id === sourceTrackId);
    if (!sourceTrackId || !targetTrackId || !source) {
        throw new Error(`Cannot prove duplicate track bounds for ${sourceTrackId ?? 'unknown track'}`);
    }
    effects.affectedTrackIds.add(sourceTrackId);
    effects.affectedTrackIds.add(targetTrackId);
    const sourceClipIds = new Set([...source.clips.map((clip) => clip.id), ...orEmpty(source.alternativeClipIds)]);
    for (const clipId of sourceClipIds) {
        effects.affectedClipIds.add(clipId);
    }
    for (const lane of context.automationLanes ?? []) {
        if (lane.trackId === sourceTrackId || (lane.clipId !== undefined && sourceClipIds.has(lane.clipId))) {
            effects.automationPoints += lane.points.length;
        }
    }
}

type TrackRemovalCascade = {
    readonly trackId: string;
    readonly trackIds: Set<string>;
    readonly clipIds: Set<string>;
    readonly objectIds: Set<string>;
};

function cascadeRemovedTrackContents(
    input: DynamicCommandEffectProofInput,
    cascade: TrackRemovalCascade,
    removedTrack: ProjectContext['tracks'][number]
): void {
    for (const device of removedTrack.devices) {
        cascade.objectIds.add(device.id);
        input.effects.deletedObjects += 1;
    }
    input.effects.deletedObjects += removedTrack.sends?.length ?? 0;
}

function cascadeSurvivingTracks(input: DynamicCommandEffectProofInput, cascade: TrackRemovalCascade): void {
    for (const survivor of input.context.tracks) {
        if (survivor.id === cascade.trackId) {
            continue;
        }
        const removedSendCount = survivor.sends?.filter((send) => send.busId === cascade.trackId).length ?? 0;
        if (survivor.outputId === cascade.trackId || removedSendCount > 0) {
            cascade.trackIds.add(survivor.id);
        }
        input.effects.deletedObjects += removedSendCount;
    }
}

function cascadeTrackAutomationAndRoutes(input: DynamicCommandEffectProofInput, cascade: TrackRemovalCascade): void {
    const { context, effects } = input;
    for (const lane of context.automationLanes ?? []) {
        if (lane.trackId === cascade.trackId) {
            cascade.objectIds.add(lane.id);
            effects.automationPoints += lane.points.length;
            effects.deletedObjects += 1 + lane.points.length;
        }
    }
    for (const route of context.sidechainRoutes ?? []) {
        if (route.sourceTrackId === cascade.trackId || route.targetTrackId === cascade.trackId) {
            cascade.objectIds.add(route.id);
            cascade.trackIds.add(route.sourceTrackId);
            cascade.trackIds.add(route.targetTrackId);
            effects.deletedObjects += 1;
        }
    }
}

function cascadeTrackMidiAndTakes(input: DynamicCommandEffectProofInput, cascade: TrackRemovalCascade): void {
    const { effects } = input;
    for (const clipId of cascade.clipIds) {
        const events = readClipMidiEvents(clipId);
        for (const event of events) {
            cascade.objectIds.add(event.id);
        }
        effects.deletedObjects += events.length;
    }
    for (const lane of takeLaneStore.value?.lanes ?? []) {
        if (lane.trackId !== cascade.trackId) {
            continue;
        }
        cascade.objectIds.add(lane.id);
        for (const take of lane.takes) {
            cascade.objectIds.add(take.id);
        }
        effects.deletedObjects += 1 + lane.takes.length + lane.activeCompRegions.length;
    }
}

function cascadeTrackModulators(input: DynamicCommandEffectProofInput, cascade: TrackRemovalCascade): void {
    for (const modulator of modulationStore.value?.modulators ?? []) {
        if (modulator.trackId === cascade.trackId) {
            cascade.objectIds.add(modulator.id);
            input.effects.deletedObjects += 1 + modulator.mappings.length;
            continue;
        }
        const removedMappings = modulator.mappings.filter((mapping) => mapping.targetTrackId === cascade.trackId);
        if (removedMappings.length > 0) {
            cascade.objectIds.add(modulator.id);
            cascade.trackIds.add(modulator.trackId);
            input.effects.deletedObjects += removedMappings.length;
        }
    }
}

function proveRemoveTrack(input: DynamicCommandEffectProofInput): void {
    const { context, payload, effects } = input;
    const trackId = getStringField(payload, 'trackId');
    const removedTrack = context.tracks.find((track) => track.id === trackId);
    if (!trackId || !removedTrack) {
        throw new Error(`Cannot prove track removal bounds for ${trackId ?? 'unknown track'}`);
    }
    const clipIds = new Set([
        ...removedTrack.clips.map((clip) => clip.id),
        ...orEmpty(removedTrack.alternativeClipIds),
    ]);
    const cascade: TrackRemovalCascade = {
        trackId,
        trackIds: new Set([trackId]),
        clipIds: new Set(clipIds),
        objectIds: new Set<string>(),
    };
    cascadeRemovedTrackContents(input, cascade, removedTrack);
    cascadeSurvivingTracks(input, cascade);
    cascadeTrackAutomationAndRoutes(input, cascade);
    cascadeTrackMidiAndTakes(input, cascade);
    cascadeTrackModulators(input, cascade);
    const cascadeTargetIds = new Set([...cascade.trackIds, ...cascade.clipIds, ...cascade.objectIds]);
    const protectedOverlap = (input.protectedTargetIds ?? []).filter((id) => cascadeTargetIds.has(id));
    if (protectedOverlap.length > 0) {
        throw new Error(`Track removal targets protected objects: ${protectedOverlap.join(', ')}`);
    }
    for (const id of cascade.trackIds) {
        effects.affectedTrackIds.add(id);
    }
    for (const id of cascade.clipIds) {
        effects.affectedClipIds.add(id);
    }
    for (const id of cascade.objectIds) {
        effects.affectedTargetIds.add(id);
    }
}

function proveRemoveClip(input: DynamicCommandEffectProofInput): void {
    const { context, payload, effects } = input;
    const clipId = getStringField(payload, 'clipId');
    const owner = context.tracks.find((track) => track.clips.some((clip) => clip.id === clipId));
    const clip = owner?.clips.find((candidate) => candidate.id === clipId);
    if (!clipId || !owner || !clip) {
        throw new Error(`Cannot prove clip removal bounds for ${clipId ?? 'unknown clip'}`);
    }
    effects.affectedTrackIds.add(owner.id);
    effects.affectedClipIds.add(clipId);
    if (timelineEditingStore.value?.rippleEditing) {
        for (const shifted of owner.clips.filter((candidate) => candidate.startBeat >= clip.endBeat)) {
            effects.affectedClipIds.add(shifted.id);
            for (const lane of context.automationLanes ?? []) {
                if (lane.clipId === shifted.id) {
                    effects.affectedTargetIds.add(lane.id);
                    effects.automationPoints += lane.points.length;
                }
            }
        }
    }
    for (const lane of context.automationLanes ?? []) {
        if (lane.clipId === clipId) {
            effects.affectedTargetIds.add(lane.id);
            effects.automationPoints += lane.points.length;
            effects.deletedObjects += 1 + lane.points.length;
        }
    }
    const events = readClipMidiEvents(clipId);
    for (const event of events) {
        effects.affectedTargetIds.add(event.id);
    }
    effects.deletedObjects += events.length;
}

function proveAutomationLaneRewrite(input: DynamicCommandEffectProofInput): void {
    const { context, effects } = input;
    const laneId = getStringField(input.payload, 'laneId');
    if (!laneId) {
        return;
    }
    const lane = context.automationLanes?.find((candidate) => candidate.id === laneId);
    if (!lane) {
        throw new Error(`Cannot prove automation bounds for lane ${laneId}`);
    }
    effects.affectedTrackIds.add(lane.trackId);
    if (lane.clipId) {
        effects.affectedClipIds.add(lane.clipId);
    }
    effects.automationPoints += lane.points.length;
    if (input.actionType === 'thinAutomation') {
        effects.deletedObjects += lane.points.length;
    }
}

const proverByKind: { readonly [Kind in DynamicEffectProofKind]: DynamicCommandEffectProver } = {
    none: proveNoDynamicEffects,
    clearSolos: proveClearSolos,
    duplicateClip: proveDuplicateClip,
    duplicateTrack: proveDuplicateTrack,
    removeTrack: proveRemoveTrack,
    removeClip: proveRemoveClip,
    automationLaneRewrite: proveAutomationLaneRewrite,
};

/** Action types can arrive untrusted, so only own keys select a proof. */
export function proveDynamicCommandEffects(input: DynamicCommandEffectProofInput): void {
    if (!Object.hasOwn(dynamicEffectProofKindByActionType, input.actionType)) {
        return;
    }
    proverByKind[dynamicEffectProofKindByActionType[input.actionType]](input);
}
