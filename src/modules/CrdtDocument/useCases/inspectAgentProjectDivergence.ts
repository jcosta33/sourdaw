import { DOC_PREFIX_ROOT } from '../models/CrdtDocumentTypes';
import { automergeRepository } from '../repositories/automergeRepository';

import { agentProjectInspectionPort } from './agentProjectInspectionPort';
import { captureProjectRevision } from './captureProjectRevision';
import { type AgentProjectDivergence, classifyAgentProjectDivergence } from './classifyAgentProjectDivergence';
import { findAutomergeProjectConflicts } from './findAutomergeProjectConflicts';
import { parseProjectRevision } from './parseProjectRevision';

type InspectAgentProjectDivergenceInput = {
    baseRevision: string;
    commandsCompatible: boolean;
    targetIds: readonly string[];
};

function ambiguous(targetIds: readonly string[]): AgentProjectDivergence {
    const normalizedTargetIds = [...new Set(targetIds)].toSorted();
    return {
        kind: 'ambiguous-same-object',
        mayReapply: false,
        repairCandidates: [{ kind: 'review-ambiguous-target', targetIds: normalizedTargetIds }],
        targetIds: normalizedTargetIds,
    };
}

function inspectProject(input: {
    document: Readonly<Record<string, unknown>>;
    targetIds: readonly string[];
}): ReturnType<typeof agentProjectInspectionPort.inspect> {
    try {
        return agentProjectInspectionPort.inspect({
            projectDocument: input.document,
            targetIds: input.targetIds,
        });
    } catch {
        return null;
    }
}

function classifyUnresolvedConflicts(input: {
    document: Readonly<Record<string, unknown>>;
    targetIds: readonly string[];
}): AgentProjectDivergence | null {
    const conflicts = findAutomergeProjectConflicts(input);
    if (conflicts.length === 0) {
        return null;
    }
    const affectedTargetIds = [...new Set(conflicts.flatMap((conflict) => conflict.targetIds))].toSorted();
    const repairCandidates = conflicts.map((conflict) => ({
        ...conflict,
        kind: 'choose-automerge-conflict-value' as const,
    }));
    if (affectedTargetIds.some((targetId) => input.targetIds.includes(targetId))) {
        return {
            kind: 'ambiguous-same-object',
            mayReapply: false,
            repairCandidates,
            targetIds: affectedTargetIds,
        };
    }
    return {
        kind: 'invariant-breaking',
        mayReapply: false,
        repairCandidates,
        targetIds: affectedTargetIds,
    };
}

export function inspectAgentProjectDivergence(input: InspectAgentProjectDivergenceInput): AgentProjectDivergence {
    const currentRevision = captureProjectRevision();
    const currentDocument = automergeRepository.getDoc<Record<string, unknown>>(DOC_PREFIX_ROOT);
    if (!currentDocument || !agentProjectInspectionPort.isConfigured()) {
        return ambiguous(input.targetIds);
    }
    const unresolvedConflicts = classifyUnresolvedConflicts({
        document: currentDocument,
        targetIds: input.targetIds,
    });
    if (unresolvedConflicts) {
        return unresolvedConflicts;
    }
    if (input.baseRevision === currentRevision) {
        const inspection = inspectProject({ document: currentDocument, targetIds: input.targetIds });
        if (!inspection) {
            return ambiguous(input.targetIds);
        }
        return classifyAgentProjectDivergence({
            ...inspection,
            baseRevision: input.baseRevision,
            baseTargetFingerprints: inspection.targetFingerprints,
            commandsCompatible: input.commandsCompatible,
            currentRevision,
            currentTargetFingerprints: inspection.targetFingerprints,
            targetIds: input.targetIds,
        });
    }

    const baseRevision = parseProjectRevision(input.baseRevision);
    const rootReference = baseRevision?.documents.find(({ docId }) => docId === DOC_PREFIX_ROOT);
    if (
        !baseRevision ||
        !rootReference ||
        baseRevision.documentIdentityEpoch !== automergeRepository.getDocumentIdentityEpoch()
    ) {
        return ambiguous(input.targetIds);
    }
    let baseDocument: Readonly<Record<string, unknown>> | undefined;
    try {
        baseDocument = automergeRepository.getDocAtHeads<Record<string, unknown>>(DOC_PREFIX_ROOT, rootReference.heads);
    } catch {
        return ambiguous(input.targetIds);
    }
    if (!baseDocument) {
        return ambiguous(input.targetIds);
    }
    const baseInspection = inspectProject({ document: baseDocument, targetIds: input.targetIds });
    const currentInspection = inspectProject({ document: currentDocument, targetIds: input.targetIds });
    if (!baseInspection || !currentInspection) {
        return ambiguous(input.targetIds);
    }
    return classifyAgentProjectDivergence({
        audioGraphValid: currentInspection.audioGraphValid,
        baseRevision: input.baseRevision,
        baseTargetFingerprints: baseInspection.targetFingerprints,
        commandsCompatible: input.commandsCompatible,
        currentRevision,
        currentTargetFingerprints: currentInspection.targetFingerprints,
        projectInvariantsValid: currentInspection.projectInvariantsValid,
        targetIds: input.targetIds,
    });
}
