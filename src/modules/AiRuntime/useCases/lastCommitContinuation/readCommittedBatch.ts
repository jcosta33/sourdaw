import { undoHistoryStore } from '#/modules/Command/stores';

import { type CommittedBatch, type CommittedCommand } from '../../models/CommittedBatch';
import { type ThreadContext } from '../../models/ThreadContext';
import { agentRunStore } from '../../stores/agentRunStore';

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The committed batch as the undo history holds it: every entry of the commit's revert group, in order. */
export function readCommittedBatch(commit: NonNullable<ThreadContext['lastCommit']>): CommittedBatch | null {
    const run = agentRunStore.value?.runs.find((candidate) => candidate.runId === commit.runId);
    const receipt = run?.receipts.find((candidate) => commit.receiptIds.includes(candidate.receiptIdentity));
    const revertGroupId = receipt?.revertGroupId ?? null;
    if (revertGroupId === null) {
        return null;
    }
    const entries = (undoHistoryStore.value?.past ?? []).filter((entry) => entry.groupId === revertGroupId);
    const commands: CommittedCommand[] = [];
    for (const entry of entries) {
        if (entry.kind !== 'action') {
            return null;
        }
        const payload = 'payload' in entry.action && isRecord(entry.action.payload) ? entry.action.payload : {};
        commands.push({ type: entry.action.type, payload, label: entry.label });
    }
    if (commands.length === 0 || receipt === undefined) {
        return null;
    }
    return { runId: commit.runId, workId: receipt.workId, revertGroupId, commands };
}
