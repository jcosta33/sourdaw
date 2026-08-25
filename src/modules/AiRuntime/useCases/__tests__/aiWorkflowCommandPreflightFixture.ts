import { adjustmentLayerStore, markerStore, trackStore } from '#/modules/Arrangement/stores';
import { automationStore } from '#/modules/Automation/stores';
import { captureCommandTargetFingerprints, commandBatchPreflightPort } from '#/modules/Command/useCases';
import { captureProjectRevision, getCrdtDoc } from '#/modules/CrdtDocument/useCases';

export function configureAiWorkflowCommandPreflightFixture(projectId?: string): void {
    commandBatchPreflightPort.setProvider(({ projectDocument, targetIds }) => {
        const documentFingerprints = captureCommandTargetFingerprints({
            document: projectDocument ?? getCrdtDoc('root'),
            targetIds,
        });
        const liveFingerprints = captureCommandTargetFingerprints({
            document: {
                adjustmentLayerStore: adjustmentLayerStore.value,
                automationStore: automationStore.value,
                markerStore: markerStore.value,
                trackStore: trackStore.value,
            },
            targetIds,
        });
        const targetFingerprints = {
            ...liveFingerprints,
            ...documentFingerprints,
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
    commandBatchPreflightPort.setProvider(null);
}
