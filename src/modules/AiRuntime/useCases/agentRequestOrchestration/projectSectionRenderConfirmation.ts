import { getAgentSectionRenderArtifacts } from '#/modules/AudioRendering/useCases';

import {
    type PendingActionExecution,
    type PendingAppActionConfirmation,
} from '../../stores/pendingActionConfirmationStore';
import { getPlannedActionAffectedIds } from '../getPlannedActionAffectedIds';

type ProjectSectionRenderConfirmationInput = {
    confirmation: PendingAppActionConfirmation;
    executions?: readonly PendingActionExecution[];
    expectedSourceRevision?: string | null;
};

function getReceiptScope(confirmation: PendingAppActionConfirmation, expectedSourceRevision: string | null) {
    const renderAction = confirmation.approvalSnapshot.actions.find(
        (action) => action.type === 'renderProjectSections'
    );
    if (renderAction?.type !== 'renderProjectSections' || !renderAction.payload.jobs) {
        return null;
    }
    const artifacts = getAgentSectionRenderArtifacts();
    const completedJobIds = new Set<string>();
    const completedAffectedIds = new Set<string>();
    for (const job of renderAction.payload.jobs) {
        const matchingArtifact = artifacts.some(
            (artifact) =>
                artifact.jobId === job.jobId &&
                artifact.sectionId === job.sectionId &&
                artifact.sectionName === job.sectionName &&
                artifact.startBeat === job.startBeat &&
                artifact.endBeat === job.endBeat &&
                artifact.sampleRate === job.sampleRate &&
                artifact.tailSeconds === job.tailSeconds &&
                artifact.sourceRevision === expectedSourceRevision
        );
        if (matchingArtifact) {
            completedJobIds.add(job.jobId);
            completedAffectedIds.add(job.sectionId);
            completedAffectedIds.add(job.jobId);
        }
    }
    return {
        jobs: renderAction.payload.jobs,
        plannedAffectedIds: getPlannedActionAffectedIds(renderAction),
        plannedRenderAffectedIds: new Set(renderAction.payload.jobs.flatMap((job) => [job.sectionId, job.jobId])),
        completedAffectedIds,
        completedJobIds,
    };
}

function projectAffectedIds(execution: PendingActionExecution, scope: ReturnType<typeof getReceiptScope>): string[] {
    if (execution.actionType !== 'renderProjectSections' || !scope) {
        return execution.affectedIds;
    }
    const nonRenderAffectedIds = execution.affectedIds.filter((id) => !scope.plannedRenderAffectedIds.has(id));
    const completedPlannedAffectedIds = scope.plannedAffectedIds.filter((id) => scope.completedAffectedIds.has(id));
    return [...new Set([...nonRenderAffectedIds, ...completedPlannedAffectedIds])];
}

function formatReceipt(
    executions: readonly PendingActionExecution[],
    confirmation: PendingAppActionConfirmation
): string {
    const executedActions = executions
        .map((execution) => {
            const affectedIds = execution.affectedIds.length > 0 ? execution.affectedIds.join(', ') : 'none';
            const assignedIds = (execution.applicationAssigned?.ids ?? [])
                .map(({ field, value }) => `${field}=${value}`)
                .join(', ');
            const assignedTimestamps = (execution.applicationAssigned?.timestamps ?? [])
                .map(({ field, value }) => `${field}=${String(value)}`)
                .join(', ');
            const commandMetadata = execution.commandId
                ? `\n  - Command: v${String(execution.commandSchemaVersion)} ${execution.commandId}\n  - Application-assigned IDs: ${assignedIds || 'none'}\n  - Application-assigned timestamps: ${assignedTimestamps || 'none'}`
                : '';
            return `- **${execution.actionType}**: ${execution.label}${commandMetadata}\n  - Affected IDs: ${affectedIds}\n  - Outcome: ${execution.outcome}`;
        })
        .join('\n');
    const affectedIds = new Set(executions.flatMap((execution) => execution.affectedIds));
    const protectedTargets = confirmation.approvalSnapshot.protectedUnchanged;
    if (!protectedTargets.every((target) => !affectedIds.has(target.id))) {
        return executedActions;
    }
    const protectedUnchanged = protectedTargets.map((target) => `"${target.name}" (${target.id})`).join(', ');
    return protectedUnchanged ? `${executedActions}\n\nProtected unchanged: ${protectedUnchanged}` : executedActions;
}

export function projectSectionRenderConfirmation(input: ProjectSectionRenderConfirmationInput) {
    const expectedSourceRevision =
        input.expectedSourceRevision === undefined
            ? input.confirmation.followUpProjectRevision
            : input.expectedSourceRevision;
    const scope = getReceiptScope(input.confirmation, expectedSourceRevision);
    const executions = (input.executions ?? input.confirmation.executedActions).map((execution) => ({
        ...execution,
        affectedIds: projectAffectedIds(execution, scope),
    }));
    const incompleteJobs = scope?.jobs.filter((job) => !scope.completedJobIds.has(job.jobId)) ?? [];
    return {
        executions,
        incompleteSectionRenders:
            incompleteJobs.length > 0
                ? { jobs: incompleteJobs, missingJobIds: incompleteJobs.map((job) => job.jobId) }
                : null,
        receipt: formatReceipt(executions, input.confirmation),
    };
}
