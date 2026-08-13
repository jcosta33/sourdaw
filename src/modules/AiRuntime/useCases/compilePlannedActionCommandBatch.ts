import { compileVersionedCommandBatchEnvelope } from '#/modules/Command/useCases';
import { projectStore } from '#/modules/Project/stores';
import { type AppAction } from '#/utils/handlerContract';

import { type ProjectContext } from '../models/ProjectContext';

import { compilePendingActionCommandEnvelopes } from './compilePendingActionCommandEnvelopes';

type CompilePlannedActionCommandBatchInput = {
    actions: readonly AppAction[];
    actionLabels: readonly string[];
    autoCommit: boolean;
    group: { groupId: string; groupLabel: string };
    intent: string;
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

function getDynamicEffects(input: CompilePlannedActionCommandBatchInput) {
    const affectedTrackIds = new Set<string>();
    const affectedClipIds = new Set<string>();
    let automationPoints = 0;
    let deletedObjects = 0;
    for (const action of input.actions) {
        if (action.type === 'clearSolos') {
            for (const track of input.context.tracks) {
                if (track.soloed) {
                    affectedTrackIds.add(track.id);
                }
            }
            continue;
        }
        const payload = 'payload' in action ? action.payload : undefined;
        if (!AUTOMATION_TRANSFORM_TYPES.has(action.type)) {
            continue;
        }
        const laneId = getStringField(payload, 'laneId');
        if (!laneId) {
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
    }
    return {
        affectedTrackIds: [...affectedTrackIds],
        affectedClipIds: [...affectedClipIds],
        automationPoints,
        deletedObjects,
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
            runId: input.runId,
            batchId: input.group.groupId,
            projectId: String(projectStore.value?.createdAt ?? 0),
            baseRevision: input.projectRevision,
            intent: input.intent,
            commands: commandEnvelopes,
            protectedTargetIds: input.protectedTargetIds,
            autoCommit: input.autoCommit,
            dynamicEffects: getDynamicEffects(input),
        }),
    };
}
