import { revertActionGroupsAtomically } from '#/modules/Command/useCases';
import {
    captureProjectIdentity,
    captureProjectMutationAuthorization,
    settlePendingProjectWritesAndCaptureRevision,
} from '#/modules/CrdtDocument/useCases';

import { markGroupReverted } from '../stores/aiActionHistoryStore';
import { appendChatMessage } from '../stores/chatStore';

import { type AppliedVibeRunBatch, readAppliedVibeRunBatches } from './agentRequestOrchestration/readVibeRunOutcomes';
import { agentRunLifecycle } from './agentRunLifecycle';
import { describeVibeRunObjective } from './vibeRun/describeVibeRunObjective';

type RevertVibeRunInput = {
    runId: string;
};

type RevertVibeRunOutput = { status: 'reverted'; groupIds: string[] } | { status: 'refused'; reason: string };

type GroupRefusal = Extract<Awaited<ReturnType<typeof revertActionGroupsAtomically>>, { status: 'refused' }>;

function describeGroupRefusal(refusal: GroupRefusal): string {
    switch (refusal.reason) {
        case 'not-applied':
            return 'an applied batch no longer stands in the undo history as it was committed';
        case 'not-replayable':
            return 'part of an applied batch has no command that undoes it';
        case 'conflict':
            return `the project has changed since the batches were applied (${refusal.detail.replace(/\.$/u, '')})`;
        default: {
            const exhaustive: never = refusal.reason;
            throw new Error(`Unsupported group revert refusal: ${String(exhaustive)}`);
        }
    }
}

function describeBatches(batches: readonly AppliedVibeRunBatch[]): string {
    return batches
        .map((applied) => `batch ${String(applied.position)} (${describeVibeRunObjective(applied.batch)})`)
        .join(', ');
}

function postOutcome(runId: string, content: string, error?: string): void {
    appendChatMessage({
        id: `msg-${crypto.randomUUID()}`,
        role: 'assistant',
        content,
        timestamp: Date.now(),
        isCommandAction: true,
        agentRunId: runId,
        projectId: captureProjectIdentity(),
        ...(error === undefined ? {} : { error }),
    });
}

function refuse(runId: string, reason: string): RevertVibeRunOutput {
    postOutcome(runId, `The vibe run was not reverted; nothing was undone: ${reason}.`, reason);
    return { status: 'refused', reason };
}

/** The revert group of every applied batch, or why the run cannot be reverted whole. */
function readRevertGroups(
    batches: readonly AppliedVibeRunBatch[]
): { status: 'ready'; groupIds: string[] } | { status: 'refused'; reason: string } {
    if (batches.length === 0) {
        return { status: 'refused', reason: 'the run applied no batch after its brief' };
    }
    const ungrouped = batches.find((applied) => applied.revertGroupId === null);
    if (ungrouped !== undefined) {
        return {
            status: 'refused',
            reason: `batch ${String(ungrouped.position)} recorded no undo group to revert`,
        };
    }
    return { status: 'ready', groupIds: batches.flatMap((applied) => applied.revertGroupId ?? []) };
}

/**
 * Undoes every batch a vibe run applied after its brief, together or not at all: their undo groups
 * replay as one atomic batch through Command, newest batch first, so a group no longer applied whole,
 * one with no inverse, or an inverse that conflicts with the project as it is now undoes nothing. The
 * production brief the run wrote stays as written. One chat message says what was undone, or why not.
 */
export async function revertVibeRun(input: RevertVibeRunInput): Promise<RevertVibeRunOutput> {
    const run = agentRunLifecycle.get(input.runId);
    const batches = run === null ? null : readAppliedVibeRunBatches(run);
    if (batches === null) {
        return refuse(input.runId, 'the vibe run is no longer held');
    }
    const groups = readRevertGroups(batches);
    if (groups.status === 'refused') {
        return refuse(input.runId, groups.reason);
    }
    try {
        // Settle the already-visible writes before capturing authority. The check permits this
        // replay's own writes, but a replacement or outside edit while it waits revokes the click.
        settlePendingProjectWritesAndCaptureRevision();
        const shouldExecute = captureProjectMutationAuthorization();
        const reverted = await revertActionGroupsAtomically(groups.groupIds, { shouldExecute });
        if (reverted.status === 'refused') {
            return refuse(input.runId, describeGroupRefusal(reverted));
        }
        for (const groupId of groups.groupIds) {
            markGroupReverted(groupId);
        }
        const warning = reverted.warning === null ? '' : ` Warning: ${reverted.warning}`;
        postOutcome(
            input.runId,
            `Reverted the vibe run: ${describeBatches(batches)} undone together. The production brief stays as written.${warning}`
        );
        return { status: 'reverted', groupIds: groups.groupIds };
    } catch (error) {
        return refuse(input.runId, error instanceof Error ? error.message : String(error));
    }
}
