import { type AppAction } from '#/utils/handlerContract';

import { type AgentRunScope } from '../../models/AgentRun';
import { type ProjectContext } from '../../models/ProjectContext';
import { type WorkflowCapabilityId } from '../../models/WorkflowCapability';

import { getApplicationProtectedObjects } from './getApplicationProtectedObjects';
import { getArticulationTransferPromptScope } from './getArticulationTransferPromptScope';
import { getBassProcessingCopyPromptScope } from './getBassProcessingCopyPromptScope';
import { getDrumPreviewBranchesPromptScope } from './getDrumPreviewBranchesPromptScope';
import { getDrumRoutingPromptScope } from './getDrumRoutingPromptScope';
import { getMidiOverlapTransformPromptScope } from './getMidiOverlapTransformPromptScope';
import { getSyncopatedArpeggioPromptScope } from './getSyncopatedArpeggioPromptScope';

/**
 * What a workflow capability owns about its own scope: the objects it admits as targets, and any
 * range it wants protected beyond them. Target ranges are not here — they belong to the commands
 * the batch compiles, and a strategy restating them can only ever agree or be wrong.
 */
type WorkflowTargetScope = Pick<AgentRunScope, 'targetIds' | 'protectedRanges'>;
type WorkflowScopeStrategy = (context: ProjectContext) => WorkflowTargetScope | undefined;

function uniqueIds(ids: readonly string[]): string[] {
    return [...new Set(ids)];
}

const workflowScopeStrategies: Readonly<Partial<Record<WorkflowCapabilityId, WorkflowScopeStrategy>>> = {
    'articulation-transfer': (context) => {
        const scope = getArticulationTransferPromptScope(context);
        if (scope.status !== 'request') {
            return undefined;
        }
        return {
            targetIds: uniqueIds(
                scope.clipPairs.flatMap((pair) => [pair.trackId, pair.sourceClipId, pair.targetClipId])
            ),
            protectedRanges: [],
        };
    },
    'bass-processing-copy': (context) => {
        const scope = getBassProcessingCopyPromptScope(context);
        if (scope.status !== 'request') {
            return undefined;
        }
        return {
            targetIds: uniqueIds(scope.entries.flatMap((entry) => [entry.layer.id, ...entry.layer.affectedTrackIds])),
            protectedRanges: [],
        };
    },
    'drum-preview-branches': (context) => {
        const scope = getDrumPreviewBranchesPromptScope(context);
        if (scope.status !== 'request') {
            return undefined;
        }
        return {
            targetIds: [scope.snare.trackId, scope.hiHat.trackId, scope.snare.clipId, scope.hiHat.clipId],
            protectedRanges: [],
        };
    },
    'drum-routing': (context) => {
        const scope = getDrumRoutingPromptScope(context);
        if (scope.status !== 'request') {
            return undefined;
        }
        return {
            targetIds: [scope.busId, ...scope.targetIds],
            protectedRanges: [],
        };
    },
    'midi-overlap-shortening': (context) => {
        const scope = getMidiOverlapTransformPromptScope(context);
        if (scope.status !== 'request') {
            return undefined;
        }
        return {
            targetIds: scope.entries.flatMap((entry) => [entry.clipId, entry.trackId]),
            protectedRanges: [],
        };
    },
    'syncopated-arpeggio': (context) => {
        const scope = getSyncopatedArpeggioPromptScope(context);
        if (scope.status !== 'request') {
            return undefined;
        }
        return {
            targetIds: [scope.trackId, scope.clipId],
            protectedRanges: [],
        };
    },
};

/** Derives final workflow authority from application-owned project and workflow evidence. */
export function getApplicationWorkflowScope(input: {
    actions: readonly AppAction[];
    context: ProjectContext;
    prompt: string;
    targetRanges: AgentRunScope['targetRanges'];
    workflowCapabilityId: WorkflowCapabilityId | undefined;
}): AgentRunScope | undefined {
    const strategy = input.workflowCapabilityId ? workflowScopeStrategies[input.workflowCapabilityId] : undefined;
    const targetScope = strategy?.(input.context);
    if (targetScope === undefined) {
        return undefined;
    }
    return {
        ...targetScope,
        targetRanges: input.targetRanges.map((range) => ({ ...range })),
        protectedTargetIds: getApplicationProtectedObjects(input).map((object) => object.id),
    };
}
