import { createStore } from '#/infra/store/createStore';

export type AgentDivergenceRepairCandidate =
    | {
          kind: 'replan-without-deleted-target' | 'review-ambiguous-target' | 'repair-project-invariants';
          targetIds: readonly string[];
      }
    | {
          conflictIds: readonly string[];
          kind: 'choose-automerge-conflict-value';
          path: readonly (number | string)[];
          targetIds: readonly string[];
      };

export type AgentProjectRepairState = {
    audioGraphValid: boolean;
    detectedRevision: string;
    inspectionAvailable: boolean;
    projectInvariantsValid: boolean;
    rawProjectRetained: true;
    repairCandidates: readonly AgentDivergenceRepairCandidate[];
    status: 'repair-required';
};

export const agentProjectRepairStateStore = createStore<AgentProjectRepairState | null>({
    initialData: null,
});
