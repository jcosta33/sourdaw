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

type WorkflowTargetScope = Pick<AgentRunScope, 'targetIds' | 'targetRanges' | 'protectedRanges'>;
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
            targetRanges: scope.clipPairs.map((pair) => ({
                startBeat: Math.min(...pair.notePairs.map((notePair) => notePair.relativeStartBeat)),
                endBeat: Math.max(...pair.notePairs.map((notePair) => notePair.relativeStartBeat)),
            })),
            protectedRanges: [],
        };
    },
    'bass-processing-copy': (context) => {
        const scope = getBassProcessingCopyPromptScope(context);
        if (scope.status !== 'request') {
            return undefined;
        }
        return {
            targetIds: uniqueIds([
                ...scope.entries.flatMap((entry) => [entry.layer.id, ...entry.layer.affectedTrackIds]),
                scope.targetSection.id,
            ]),
            targetRanges: scope.entries.map((entry) => ({
                startBeat: entry.targetRegion.startBeat,
                endBeat: entry.targetRegion.endBeat,
            })),
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
            targetRanges: [{ startBeat: scope.section.startBeat, endBeat: scope.section.endBeat }],
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
            targetRanges: [],
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
            targetRanges: scope.entries.map((entry) => ({
                startBeat: Math.min(...entry.expectedNotes.map((note) => note.startBeat)),
                endBeat: Math.max(...entry.expectedNotes.map((note) => note.startBeat)),
            })),
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
            targetRanges: [],
            protectedRanges: [],
        };
    },
};

/** Derives final workflow authority from application-owned project and workflow evidence. */
export function getApplicationWorkflowScope(input: {
    actions: readonly AppAction[];
    context: ProjectContext;
    prompt: string;
    workflowCapabilityId: WorkflowCapabilityId | undefined;
}): AgentRunScope | undefined {
    const strategy = input.workflowCapabilityId ? workflowScopeStrategies[input.workflowCapabilityId] : undefined;
    const targetScope = strategy?.(input.context);
    if (targetScope === undefined) {
        return undefined;
    }
    return {
        ...targetScope,
        protectedTargetIds: getApplicationProtectedObjects(input).map((object) => object.id),
    };
}
