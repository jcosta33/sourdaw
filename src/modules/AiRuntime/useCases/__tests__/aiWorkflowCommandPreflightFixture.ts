import { trackStore } from '#/modules/Arrangement/stores';
import { captureCommandTargetFingerprints, commandBatchPreflightPort } from '#/modules/Command/useCases';
import { captureProjectRevision } from '#/modules/CrdtDocument/useCases';

export function configureAiWorkflowCommandPreflightFixture(): void {
    commandBatchPreflightPort.setProvider(({ targetIds }) => {
        const targetFingerprints = {
            ...captureCommandTargetFingerprints({
                document: trackStore.value,
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
            projectId: captureProjectRevision(),
            projectInvariantsValid: true,
            targetFingerprints,
        };
    });
}

export function resetAiWorkflowCommandPreflightFixture(): void {
    commandBatchPreflightPort.setProvider(null);
}
