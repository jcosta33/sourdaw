import { getAgentSectionRenderArtifacts } from '#/modules/AudioRendering/useCases';

import {
    type PendingActionExecution,
    type PendingAppActionConfirmation,
} from '../../stores/pendingActionConfirmationStore';
import { getExactAgentActionHash } from '../getExactAgentActionHash';
import { getPlannedActionAffectedIds } from '../getPlannedActionAffectedIds';

type ProjectSectionRenderConfirmationInput = {
    confirmation: PendingAppActionConfirmation;
    executions?: readonly PendingActionExecution[];
    expectedSourceRevision?: string | null;
};

type ApprovedRenderAction = Extract<
    PendingAppActionConfirmation['approvalSnapshot']['actions'][number],
    { type: 'renderProjectSections' }
>;
type SectionRenderReceiptScope = {
    commandId: string | null;
    jobs: NonNullable<ApprovedRenderAction['payload']['jobs']>;
    plannedAffectedIds: string[];
    plannedRenderAffectedIds: ReadonlySet<string>;
    completedAffectedIds: ReadonlySet<string>;
    completedJobIds: ReadonlySet<string>;
    performedJobIds: ReadonlySet<string>;
    reviewRequiredArtifacts: Array<{ jobId: string; warnings: readonly string[] }>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getApprovedCommandId(
    confirmation: PendingAppActionConfirmation,
    actionIndex: number,
    action: ApprovedRenderAction
): string | null {
    const serialized = confirmation.approvalSnapshot.commandEnvelopes?.[actionIndex];
    if (!serialized) {
        return null;
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(serialized) as unknown;
    } catch {
        return null;
    }
    if (
        !isRecord(parsed) ||
        parsed.operation !== action.type ||
        typeof parsed.commandId !== 'string' ||
        parsed.commandId.length === 0
    ) {
        return null;
    }
    const actionHash = getExactAgentActionHash({ operation: action.type, arguments: action.payload });
    const commandHash = getExactAgentActionHash({
        operation: parsed.operation,
        arguments: parsed.arguments,
    });
    return actionHash === commandHash ? parsed.commandId : null;
}

function getReceiptScopes(
    confirmation: PendingAppActionConfirmation,
    expectedSourceRevision: string | null
): SectionRenderReceiptScope[] {
    const artifacts = getAgentSectionRenderArtifacts();
    const approvedRenderJobs = confirmation.approvalSnapshot.actions.flatMap((action) =>
        action.type === 'renderProjectSections' ? (action.payload.jobs ?? []) : []
    );
    const duplicateJobIds = new Set(
        approvedRenderJobs.map(({ jobId }) => jobId).filter((jobId, index, jobIds) => jobIds.indexOf(jobId) !== index)
    );
    return confirmation.approvalSnapshot.actions.flatMap((action, actionIndex) => {
        if (action.type !== 'renderProjectSections' || !action.payload.jobs) {
            return [];
        }
        const completedJobIds = new Set<string>();
        const performedJobIds = new Set<string>();
        const reviewRequiredArtifacts: Array<{ jobId: string; warnings: readonly string[] }> = [];
        const completedAffectedIds = new Set<string>();
        for (const job of action.payload.jobs) {
            const matchingArtifacts = duplicateJobIds.has(job.jobId)
                ? []
                : artifacts.filter(
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
            const matchingArtifact = matchingArtifacts.length === 1 ? matchingArtifacts[0] : undefined;
            if (matchingArtifact) {
                performedJobIds.add(job.jobId);
                completedAffectedIds.add(job.sectionId);
                completedAffectedIds.add(job.jobId);
                if (matchingArtifact.warnings.length === 0) {
                    completedJobIds.add(job.jobId);
                } else {
                    reviewRequiredArtifacts.push({ jobId: job.jobId, warnings: matchingArtifact.warnings });
                }
            }
        }
        return [
            {
                commandId: getApprovedCommandId(confirmation, actionIndex, action),
                jobs: action.payload.jobs,
                plannedAffectedIds: getPlannedActionAffectedIds(action),
                plannedRenderAffectedIds: new Set(action.payload.jobs.flatMap((job) => [job.sectionId, job.jobId])),
                completedAffectedIds,
                completedJobIds,
                performedJobIds,
                reviewRequiredArtifacts,
            },
        ];
    });
}

function projectAffectedIds(
    execution: PendingActionExecution,
    scope: SectionRenderReceiptScope | null,
    allPlannedRenderAffectedIds: ReadonlySet<string>
): string[] {
    if (execution.actionType !== 'renderProjectSections') {
        return execution.affectedIds;
    }
    const nonRenderAffectedIds = execution.affectedIds.filter((id) => !allPlannedRenderAffectedIds.has(id));
    if (!scope) {
        return nonRenderAffectedIds;
    }
    const completedPlannedAffectedIds = scope.plannedAffectedIds.filter((id) => scope.completedAffectedIds.has(id));
    return [...new Set([...nonRenderAffectedIds, ...completedPlannedAffectedIds])];
}

function getExecutionScope(
    execution: PendingActionExecution,
    scopes: readonly SectionRenderReceiptScope[],
    renderExecutionIndex: number
): SectionRenderReceiptScope | null {
    if (execution.commandId) {
        const matchingScopes = scopes.filter(({ commandId }) => commandId === execution.commandId);
        return matchingScopes.length === 1 ? (matchingScopes[0] ?? null) : null;
    }
    if (scopes.length === 1) {
        return scopes[0] ?? null;
    }
    return scopes[renderExecutionIndex] ?? null;
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
    const scopes = getReceiptScopes(input.confirmation, expectedSourceRevision);
    const allPlannedRenderAffectedIds = new Set(
        scopes.flatMap(({ plannedRenderAffectedIds }) => [...plannedRenderAffectedIds])
    );
    let renderExecutionIndex = 0;
    const executions = (input.executions ?? input.confirmation.executedActions).map((execution) => {
        const scope = getExecutionScope(execution, scopes, renderExecutionIndex);
        if (execution.actionType === 'renderProjectSections') {
            renderExecutionIndex += 1;
        }
        return {
            ...execution,
            affectedIds: projectAffectedIds(execution, scope, allPlannedRenderAffectedIds),
        };
    });
    const approvedJobs = scopes.flatMap(({ jobs }) => jobs);
    const completedJobIds = new Set(scopes.flatMap(({ completedJobIds: jobIds }) => [...jobIds]));
    const performedJobIds = new Set(scopes.flatMap(({ performedJobIds: jobIds }) => [...jobIds]));
    const incompleteJobs = scopes.flatMap(({ jobs, performedJobIds: jobIds }) =>
        jobs.filter((job) => !jobIds.has(job.jobId))
    );
    return {
        approvedSectionRenderJobs: approvedJobs,
        completedSectionRenderJobIds: completedJobIds,
        performedSectionRenderJobIds: performedJobIds,
        executions,
        incompleteSectionRenders:
            incompleteJobs.length > 0
                ? { jobs: incompleteJobs, missingJobIds: incompleteJobs.map((job) => job.jobId) }
                : null,
        reviewRequiredSectionRenders: scopes.flatMap(({ reviewRequiredArtifacts }) => reviewRequiredArtifacts),
        receipt: formatReceipt(executions, input.confirmation),
    };
}
