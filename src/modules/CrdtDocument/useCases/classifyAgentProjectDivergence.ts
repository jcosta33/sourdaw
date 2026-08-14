import { type AgentDivergenceRepairCandidate } from '../stores/agentProjectRepairStateStore';

type ClassifyAgentProjectDivergenceInput = {
    audioGraphValid: boolean;
    baseRevision: string;
    baseTargetFingerprints: Readonly<Record<string, string>>;
    commandsCompatible: boolean;
    currentRevision: string;
    currentTargetFingerprints: Readonly<Record<string, string>>;
    projectInvariantsValid: boolean;
    targetIds: readonly string[];
};

export type AgentProjectDivergence =
    | { kind: 'none'; mayReapply: true; repairCandidates: readonly []; targetIds: readonly [] }
    | { kind: 'non-overlapping'; mayReapply: true; repairCandidates: readonly []; targetIds: readonly [] }
    | {
          kind: 'compatible-same-object';
          mayReapply: true;
          repairCandidates: readonly [];
          targetIds: readonly string[];
      }
    | {
          kind: 'ambiguous-same-object';
          mayReapply: false;
          repairCandidates: readonly AgentDivergenceRepairCandidate[];
          targetIds: readonly string[];
      }
    | {
          kind: 'deleted-target';
          mayReapply: false;
          repairCandidates: readonly AgentDivergenceRepairCandidate[];
          targetIds: readonly string[];
      }
    | {
          kind: 'invariant-breaking';
          mayReapply: false;
          repairCandidates: readonly AgentDivergenceRepairCandidate[];
          targetIds: readonly string[];
      };

export function classifyAgentProjectDivergence(input: ClassifyAgentProjectDivergenceInput): AgentProjectDivergence {
    const targetIds = [...new Set(input.targetIds)].toSorted();
    if (!input.projectInvariantsValid || !input.audioGraphValid) {
        return {
            kind: 'invariant-breaking',
            mayReapply: false,
            repairCandidates: [{ kind: 'repair-project-invariants', targetIds }],
            targetIds,
        };
    }
    if (input.baseRevision === input.currentRevision) {
        return { kind: 'none', mayReapply: true, repairCandidates: [], targetIds: [] };
    }

    const deletedTargetIds = targetIds.filter(
        (targetId) =>
            input.baseTargetFingerprints[targetId] !== undefined &&
            input.currentTargetFingerprints[targetId] === undefined
    );
    if (deletedTargetIds.length > 0) {
        return {
            kind: 'deleted-target',
            mayReapply: false,
            repairCandidates: [{ kind: 'replan-without-deleted-target', targetIds: deletedTargetIds }],
            targetIds: deletedTargetIds,
        };
    }

    const changedTargetIds = targetIds.filter(
        (targetId) => input.baseTargetFingerprints[targetId] !== input.currentTargetFingerprints[targetId]
    );
    if (changedTargetIds.length === 0) {
        return { kind: 'non-overlapping', mayReapply: true, repairCandidates: [], targetIds: [] };
    }
    if (input.commandsCompatible) {
        return {
            kind: 'compatible-same-object',
            mayReapply: true,
            repairCandidates: [],
            targetIds: changedTargetIds,
        };
    }
    return {
        kind: 'ambiguous-same-object',
        mayReapply: false,
        repairCandidates: [{ kind: 'review-ambiguous-target', targetIds: changedTargetIds }],
        targetIds: changedTargetIds,
    };
}
