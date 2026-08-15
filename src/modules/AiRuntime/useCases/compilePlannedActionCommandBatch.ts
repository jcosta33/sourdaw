import { takeLaneStore } from '#/modules/Arrangement/stores';
import { modulationStore } from '#/modules/Automation/stores';
import { compileVersionedCommandBatchEnvelope, parseVersionedCommandEnvelope } from '#/modules/Command/useCases';
import { midiStore } from '#/modules/MIDI/stores';
import { workspaceStore } from '#/modules/WorkspaceShell/stores';
import { type AppAction } from '#/utils/handlerContract';

import { type ProjectContext } from '../models/ProjectContext';

import { compilePendingActionCommandEnvelopes } from './compilePendingActionCommandEnvelopes';

type CompilePlannedActionCommandBatchInput = {
    actions: readonly AppAction[];
    actionLabels: readonly string[];
    autoCommit: boolean;
    autoCommitApproval?: Parameters<typeof compileVersionedCommandBatchEnvelope>[0]['autoCommitApproval'];
    group: { groupId: string; groupLabel: string };
    intent: string;
    mode?: 'commit' | 'preview';
    projectRevision: string;
    protectedTargetIds?: readonly string[];
    runId: string;
    context: ProjectContext;
};

const AUTOMATION_TRANSFORM_TYPES = new Set<AppAction['type']>([
    'scaleAutomation',
    'stretchAutomation',
    'invertAutomation',
    'reverseAutomation',
    'thinAutomation',
    'quantizeAutomation',
]);

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

function getDynamicEffects(input: CompilePlannedActionCommandBatchInput, commandEnvelopes: readonly string[]) {
    const aggregateAffectedTrackIds = new Set<string>();
    const aggregateAffectedClipIds = new Set<string>();
    const aggregateAffectedTargetIds = new Set<string>();
    let aggregateAutomationPoints = 0;
    let aggregateDeletedObjects = 0;
    const commandEffects: Array<{
        commandId: string;
        effects: {
            affectedTrackIds: string[];
            affectedClipIds: string[];
            affectedTargetIds: string[];
            automationPoints: number;
            deletedObjects: number;
        };
    }> = [];
    for (const [index, action] of input.actions.entries()) {
        const parsedCommand = parseVersionedCommandEnvelope(commandEnvelopes[index] ?? '');
        if (parsedCommand.status !== 'valid') {
            throw new Error(`Cannot prove dynamic bounds for ${action.type}`);
        }
        const commandId = parsedCommand.envelope.commandId;
        const affectedTrackIds = new Set<string>();
        const affectedClipIds = new Set<string>();
        const affectedTargetIds = new Set<string>();
        let automationPoints = 0;
        let deletedObjects = 0;
        function recordDynamicEffects(): void {
            for (const id of affectedTrackIds) {
                aggregateAffectedTrackIds.add(id);
            }
            for (const id of affectedClipIds) {
                aggregateAffectedClipIds.add(id);
            }
            for (const id of affectedTargetIds) {
                aggregateAffectedTargetIds.add(id);
            }
            aggregateAutomationPoints += automationPoints;
            aggregateDeletedObjects += deletedObjects;
            if (
                affectedTrackIds.size === 0 &&
                affectedClipIds.size === 0 &&
                affectedTargetIds.size === 0 &&
                automationPoints === 0 &&
                deletedObjects === 0
            ) {
                return;
            }
            commandEffects.push({
                commandId,
                effects: {
                    affectedTrackIds: [...affectedTrackIds],
                    affectedClipIds: [...affectedClipIds],
                    affectedTargetIds: [...affectedTargetIds],
                    automationPoints,
                    deletedObjects,
                },
            });
        }
        if (action.type === 'clearSolos') {
            for (const track of input.context.tracks) {
                if (track.soloed) {
                    affectedTrackIds.add(track.id);
                }
            }
            recordDynamicEffects();
            continue;
        }
        const payload = parsedCommand.envelope.arguments;
        if (action.type === 'duplicateClip' || action.type === 'duplicateClipToNextBar') {
            const sourceClipId = getStringField(payload, 'clipId');
            const targetClipId = getStringField(payload, 'targetClipId');
            const owner = input.context.tracks.find((track) => track.clips.some((clip) => clip.id === sourceClipId));
            if (!sourceClipId || !targetClipId || !owner) {
                throw new Error(`Cannot prove duplicate clip bounds for ${sourceClipId ?? 'unknown clip'}`);
            }
            affectedTrackIds.add(owner.id);
            affectedClipIds.add(sourceClipId);
            affectedClipIds.add(targetClipId);
            for (const lane of input.context.automationLanes ?? []) {
                if (lane.clipId === sourceClipId) {
                    automationPoints += lane.points.length;
                }
            }
            recordDynamicEffects();
            continue;
        }
        if (action.type === 'duplicateTrack') {
            const sourceTrackId = getStringField(payload, 'trackId');
            const targetTrackId = getStringField(payload, 'targetTrackId');
            const source = input.context.tracks.find((track) => track.id === sourceTrackId);
            if (!sourceTrackId || !targetTrackId || !source) {
                throw new Error(`Cannot prove duplicate track bounds for ${sourceTrackId ?? 'unknown track'}`);
            }
            affectedTrackIds.add(sourceTrackId);
            affectedTrackIds.add(targetTrackId);
            const sourceClipIds = new Set([
                ...source.clips.map((clip) => clip.id),
                ...(source.alternativeClipIds ?? []),
            ]);
            for (const clipId of sourceClipIds) {
                affectedClipIds.add(clipId);
            }
            for (const lane of input.context.automationLanes ?? []) {
                if (lane.trackId === sourceTrackId || (lane.clipId !== undefined && sourceClipIds.has(lane.clipId))) {
                    automationPoints += lane.points.length;
                }
            }
            recordDynamicEffects();
            continue;
        }
        if (action.type === 'removeTrack') {
            const trackId = getStringField(payload, 'trackId');
            const removedTrack = input.context.tracks.find((track) => track.id === trackId);
            if (!trackId || !removedTrack) {
                throw new Error(`Cannot prove track removal bounds for ${trackId ?? 'unknown track'}`);
            }
            const cascadeTrackIds = new Set([trackId]);
            const cascadeClipIds = new Set<string>();
            const cascadeObjectIds = new Set<string>();
            const clipIds = new Set([
                ...removedTrack.clips.map((clip) => clip.id),
                ...(removedTrack.alternativeClipIds ?? []),
            ]);
            for (const clipId of clipIds) {
                cascadeClipIds.add(clipId);
            }
            for (const device of removedTrack.devices) {
                cascadeObjectIds.add(device.id);
                deletedObjects += 1;
            }
            deletedObjects += removedTrack.sends?.length ?? 0;
            for (const survivor of input.context.tracks) {
                if (survivor.id === trackId) {
                    continue;
                }
                const removedSendCount = survivor.sends?.filter((send) => send.busId === trackId).length ?? 0;
                if (survivor.outputId === trackId || removedSendCount > 0) {
                    cascadeTrackIds.add(survivor.id);
                }
                deletedObjects += removedSendCount;
            }
            for (const lane of input.context.automationLanes ?? []) {
                if (lane.trackId === trackId) {
                    cascadeObjectIds.add(lane.id);
                    automationPoints += lane.points.length;
                    deletedObjects += 1 + lane.points.length;
                }
            }
            for (const route of input.context.sidechainRoutes ?? []) {
                if (route.sourceTrackId === trackId || route.targetTrackId === trackId) {
                    cascadeObjectIds.add(route.id);
                    cascadeTrackIds.add(route.sourceTrackId);
                    cascadeTrackIds.add(route.targetTrackId);
                    deletedObjects += 1;
                }
            }
            const midiState = midiStore.value;
            for (const clipId of clipIds) {
                const events = [
                    ...(midiState?.notesByClipId[clipId] ?? []),
                    ...(midiState?.ccByClipId[clipId] ?? []),
                    ...(midiState?.pitchBendByClipId[clipId] ?? []),
                ];
                for (const event of events) {
                    cascadeObjectIds.add(event.id);
                }
                deletedObjects += events.length;
            }
            for (const lane of takeLaneStore.value?.lanes ?? []) {
                if (lane.trackId !== trackId) {
                    continue;
                }
                cascadeObjectIds.add(lane.id);
                for (const take of lane.takes) {
                    cascadeObjectIds.add(take.id);
                }
                deletedObjects += 1 + lane.takes.length + lane.activeCompRegions.length;
            }
            for (const modulator of modulationStore.value?.modulators ?? []) {
                if (modulator.trackId === trackId) {
                    cascadeObjectIds.add(modulator.id);
                    deletedObjects += 1 + modulator.mappings.length;
                    continue;
                }
                const removedMappings = modulator.mappings.filter((mapping) => mapping.targetTrackId === trackId);
                if (removedMappings.length > 0) {
                    cascadeObjectIds.add(modulator.id);
                    cascadeTrackIds.add(modulator.trackId);
                    deletedObjects += removedMappings.length;
                }
            }
            const cascadeTargetIds = new Set([...cascadeTrackIds, ...cascadeClipIds, ...cascadeObjectIds]);
            const protectedOverlap = (input.protectedTargetIds ?? []).filter((id) => cascadeTargetIds.has(id));
            if (protectedOverlap.length > 0) {
                throw new Error(`Track removal targets protected objects: ${protectedOverlap.join(', ')}`);
            }
            for (const id of cascadeTrackIds) {
                affectedTrackIds.add(id);
            }
            for (const id of cascadeClipIds) {
                affectedClipIds.add(id);
            }
            for (const id of cascadeObjectIds) {
                affectedTargetIds.add(id);
            }
            recordDynamicEffects();
            continue;
        }
        if (action.type === 'removeClip') {
            const clipId = getStringField(payload, 'clipId');
            const owner = input.context.tracks.find((track) => track.clips.some((clip) => clip.id === clipId));
            const clip = owner?.clips.find((candidate) => candidate.id === clipId);
            if (!clipId || !owner || !clip) {
                throw new Error(`Cannot prove clip removal bounds for ${clipId ?? 'unknown clip'}`);
            }
            affectedTrackIds.add(owner.id);
            affectedClipIds.add(clipId);
            if (workspaceStore.value?.rippleEditing) {
                for (const shifted of owner.clips.filter((candidate) => candidate.startBeat >= clip.endBeat)) {
                    affectedClipIds.add(shifted.id);
                    for (const lane of input.context.automationLanes ?? []) {
                        if (lane.clipId === shifted.id) {
                            affectedTargetIds.add(lane.id);
                            automationPoints += lane.points.length;
                        }
                    }
                }
            }
            for (const lane of input.context.automationLanes ?? []) {
                if (lane.clipId === clipId) {
                    affectedTargetIds.add(lane.id);
                    automationPoints += lane.points.length;
                    deletedObjects += 1 + lane.points.length;
                }
            }
            const midiState = midiStore.value;
            const events = [
                ...(midiState?.notesByClipId[clipId] ?? []),
                ...(midiState?.ccByClipId[clipId] ?? []),
                ...(midiState?.pitchBendByClipId[clipId] ?? []),
            ];
            for (const event of events) {
                affectedTargetIds.add(event.id);
            }
            deletedObjects += events.length;
            recordDynamicEffects();
            continue;
        }
        if (!AUTOMATION_TRANSFORM_TYPES.has(action.type)) {
            recordDynamicEffects();
            continue;
        }
        const laneId = getStringField(payload, 'laneId');
        if (!laneId) {
            recordDynamicEffects();
            continue;
        }
        const lane = input.context.automationLanes?.find((candidate) => candidate.id === laneId);
        if (!lane) {
            throw new Error(`Cannot prove automation bounds for lane ${laneId}`);
        }
        affectedTrackIds.add(lane.trackId);
        if (lane.clipId) {
            affectedClipIds.add(lane.clipId);
        }
        automationPoints += lane.points.length;
        if (action.type === 'thinAutomation') {
            deletedObjects += lane.points.length;
        }
        recordDynamicEffects();
    }
    return {
        affectedTrackIds: [...aggregateAffectedTrackIds],
        affectedClipIds: [...aggregateAffectedClipIds],
        affectedTargetIds: [...aggregateAffectedTargetIds],
        automationPoints: aggregateAutomationPoints,
        deletedObjects: aggregateDeletedObjects,
        commandEffects,
    };
}

export function compilePlannedActionCommandBatch(input: CompilePlannedActionCommandBatchInput) {
    const commandEnvelopes = compilePendingActionCommandEnvelopes({
        actions: input.actions,
        actionLabels: input.actionLabels,
        group: input.group,
        projectRevision: input.projectRevision,
    });
    return {
        commandEnvelopes,
        commandBatch: compileVersionedCommandBatchEnvelope({
            autoCommitApproval: input.autoCommitApproval,
            runId: input.runId,
            batchId: input.group.groupId,
            projectId: input.projectRevision,
            baseRevision: input.projectRevision,
            intent: input.intent,
            mode: input.mode,
            commands: commandEnvelopes,
            protectedTargetIds: input.protectedTargetIds,
            autoCommit: input.autoCommit,
            dynamicEffects: getDynamicEffects(input, commandEnvelopes),
        }),
    };
}
