import { useStore } from '#/infra/store/useStore';
import { agentProjectRepairStateStore, type AgentProjectRepairState } from '#/modules/CrdtDocument/stores';
import { projectStore } from '#/modules/Project/stores';
import { getProjectScopedBriefLock } from '#/modules/Project/useCases';

// Derived from the callable contract because Project keeps its use-case types private.
export type ProjectScopedBriefLock = NonNullable<ReturnType<typeof getProjectScopedBriefLock>>;

export type ProjectMutationRefusal =
    | {
          audioGraphValid: boolean;
          conflictCount: number;
          invariantsValid: boolean;
          kind: 'repair-required';
      }
    | { kind: 'production-brief-lock'; statement: string };

function countUnresolvedConflicts(repairState: AgentProjectRepairState): number {
    return repairState.repairCandidates.filter((candidate) => candidate.kind === 'choose-automerge-conflict-value')
        .length;
}

/**
 * Why `executeAppAction` is currently refusing every project mutation, or `null`.
 *
 * Repair wins over the brief lock because the repair gate is the one dispatch
 * checks first: while it holds, removing the lock would change nothing.
 */
export function deriveProjectMutationRefusal(
    repairState: AgentProjectRepairState | null,
    briefLock: ProjectScopedBriefLock | null
): ProjectMutationRefusal | null {
    if (repairState) {
        return {
            audioGraphValid: repairState.audioGraphValid,
            conflictCount: countUnresolvedConflicts(repairState),
            invariantsValid: repairState.projectInvariantsValid,
            kind: 'repair-required',
        };
    }
    if (briefLock) {
        return { kind: 'production-brief-lock', statement: briefLock.statement };
    }
    return null;
}

export const useProjectMutationRefusal = (): ProjectMutationRefusal | null => {
    const repairState = useStore(agentProjectRepairStateStore, null);
    // `getProjectScopedBriefLock` reads the project store imperatively, so this
    // subscription is what re-derives the lock when the brief changes.
    useStore(projectStore, null);
    return deriveProjectMutationRefusal(repairState, getProjectScopedBriefLock());
};
