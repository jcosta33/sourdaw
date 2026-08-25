import { captureCommandTargetFingerprints, commandBatchPreflightPort } from '#/modules/Command/useCases';
import { captureProjectRevision, getCrdtDoc } from '#/modules/CrdtDocument/useCases';

export function configureAiWorkflowCommandPreflightFixture(projectId?: string): void {
    commandBatchPreflightPort.setProvider(({ projectDocument, targetIds }) => {
        const targetFingerprints = captureCommandTargetFingerprints({
            document: projectDocument ?? getCrdtDoc('root'),
            targetIds,
        });
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
    commandBatchPreflightPort.setProvider(null);
}
