import { DOC_PREFIX_ROOT } from '../models/CrdtDocumentTypes';
import { automergeRepository } from '../repositories/automergeRepository';
import { type AgentProjectRepairState } from '../stores/agentProjectRepairStateStore';

import { agentProjectInspectionPort } from './agentProjectInspectionPort';
import { captureProjectRevision } from './captureProjectRevision';
import { findAutomergeProjectConflicts } from './findAutomergeProjectConflicts';

export function inspectCurrentAgentProjectRepairState(): AgentProjectRepairState | null {
    if (!agentProjectInspectionPort.isConfigured()) {
        return null;
    }
    const projectDocument = automergeRepository.getDoc<Record<string, unknown>>(DOC_PREFIX_ROOT);
    if (!projectDocument) {
        return null;
    }
    const conflicts = findAutomergeProjectConflicts({ document: projectDocument });
    const inspection = (() => {
        try {
            return agentProjectInspectionPort.inspect({ projectDocument, targetIds: [] });
        } catch {
            return null;
        }
    })();
    if (inspection?.projectInvariantsValid && inspection.audioGraphValid && conflicts.length === 0) {
        return null;
    }
    const conflictCandidates = conflicts.map((conflict) => ({
        ...conflict,
        kind: 'choose-automerge-conflict-value' as const,
    }));
    const repairCandidates =
        conflictCandidates.length > 0
            ? conflictCandidates
            : [{ kind: 'repair-project-invariants' as const, targetIds: [] }];
    return {
        audioGraphValid: inspection?.audioGraphValid ?? false,
        detectedRevision: captureProjectRevision(),
        inspectionAvailable: inspection !== null,
        projectInvariantsValid: inspection?.projectInvariantsValid ?? false,
        rawProjectRetained: true,
        repairCandidates,
        status: 'repair-required',
    };
}
