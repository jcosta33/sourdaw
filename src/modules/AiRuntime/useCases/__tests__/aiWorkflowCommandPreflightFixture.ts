import { runtimeGraphTopology } from '#/modules/Arrangement/useCases';
import {
    configureRuntimeGraphProjectRevisionValidator,
    configureRuntimeGraphTopologyValidator,
} from '#/modules/AudioEngine/useCases';
import { captureCommandTargetFingerprints, commandBatchPreflightPort } from '#/modules/Command/useCases';
import { captureProjectRevision, getCrdtDoc } from '#/modules/CrdtDocument/useCases';

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
}

export function resetAiWorkflowCommandPreflightFixture(): void {
    resetAiWorkflowCommandCheckpointRuntime();
    commandBatchPreflightPort.setProvider(null);
    configureRuntimeGraphProjectRevisionValidator(null);
    configureRuntimeGraphTopologyValidator(null);
}
