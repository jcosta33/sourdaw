import { captureAgentProjectInspectionState } from '#/app/captureCommandBatchPreflightState';
import { runtimeGraphTopology } from '#/modules/Arrangement/useCases';
import {
    configureRuntimeGraphProjectRevisionValidator,
    configureRuntimeGraphTopologyValidator,
} from '#/modules/AudioEngine/useCases';
import {
    captureCommandTargetFingerprints,
    commandBatchPreflightPort,
    commandBatchPreviewPort,
    commandProjectDivergencePort,
} from '#/modules/Command/useCases';
import {
    agentProjectInspectionPort,
    captureProjectRevision,
    createCommandPreviewWorkspace,
    getCrdtDoc,
    inspectAgentProjectDivergence,
} from '#/modules/CrdtDocument/useCases';

import {
    configureAiWorkflowCommandCheckpointRuntime,
    resetAiWorkflowCommandCheckpointRuntime,
} from './aiWorkflowCommandCheckpointRuntime';

export function configureAiWorkflowCommandPreflightFixture(projectId?: string): void {
    configureAiWorkflowCommandCheckpointRuntime();
    configureRuntimeGraphProjectRevisionValidator(
        (expectedProjectRevision) => captureProjectRevision() === expectedProjectRevision
    );
    configureRuntimeGraphTopologyValidator(runtimeGraphTopology.matchesCurrentProject);
    commandBatchPreflightPort.setProvider(({ projectDocument, targetIds }) => {
        const targetFingerprints: Record<string, string> = {
            ...captureCommandTargetFingerprints({
                document: projectDocument ?? getCrdtDoc('root'),
                targetIds,
            }),
        };
        for (const systemTargetId of ['master', 'hw_out']) {
            if (targetIds.includes(systemTargetId)) {
                targetFingerprints[systemTargetId] = `system-output:${systemTargetId}`;
            }
        }
        return {
            audioGraphValid: true,
            availableAssetHashes: [],
            availableAudioBufferIds: [],
            lockedRanges: [],
            projectId: projectId ?? captureProjectRevision(),
            projectInvariantsValid: true,
            targetFingerprints,
        };
    });
    // Bootstrap wires these three from the same providers. A fixture that supplies only the preflight
    // seam leaves divergence classification, project inspection and command preview answering from
    // nothing, so every confirmation route that reads them silently takes its unconfigured branch.
    agentProjectInspectionPort.setProvider(captureAgentProjectInspectionState);
    commandProjectDivergencePort.setProvider(inspectAgentProjectDivergence);
    commandBatchPreviewPort.setProvider(createCommandPreviewWorkspace);
}

/**
 * With the divergence port wired, a collaborator edit that lands on a target the batch writes is
 * refused as a classified conflict naming that target, not as a bare "the project changed". The
 * wording lives beside the provider these workflows install, so one route change is restated once.
 */
export const AMBIGUOUS_SAME_OBJECT_DIVERGENCE_REASON =
    'The approved command was not executed because project divergence is ambiguous-same-object.';

export function ambiguousSameObjectDivergence(targetIds: readonly string[]) {
    return {
        kind: 'ambiguous-same-object',
        mayReapply: false,
        repairCandidates: [{ kind: 'review-ambiguous-target', targetIds: [...targetIds] }],
        targetIds: [...targetIds],
    };
}

export function ambiguousSameObjectDivergenceMessage(targetIds: readonly string[]): string {
    const named = targetIds.join(', ');
    return `${AMBIGUOUS_SAME_OBJECT_DIVERGENCE_REASON} Affected targets: ${named}. Repair candidates: review-ambiguous-target: ${named}. Review the current project before planning again.`;
}

export function resetAiWorkflowCommandPreflightFixture(): void {
    resetAiWorkflowCommandCheckpointRuntime();
    commandBatchPreflightPort.setProvider(null);
    agentProjectInspectionPort.setProvider(null);
    commandProjectDivergencePort.setProvider(null);
    commandBatchPreviewPort.setProvider(null);
    configureRuntimeGraphProjectRevisionValidator(null);
    configureRuntimeGraphTopologyValidator(null);
}
