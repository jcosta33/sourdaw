import { runtimeGraphTopology } from '#/modules/Arrangement/useCases';
import {
    configureRuntimeGraphProjectRevisionValidator,
    configureRuntimeGraphTopologyValidator,
} from '#/modules/AudioEngine/useCases';
import { captureCommandTargetFingerprints, commandBatchPreflightPort } from '#/modules/Command/useCases';
import { captureProjectRevision, getCrdtDoc } from '#/modules/CrdtDocument/useCases';

import { getProjectContext } from '../getProjectContext';

export function configureAiWorkflowCommandPreflightFixture(projectId?: string): void {
    configureRuntimeGraphProjectRevisionValidator(
        (expectedProjectRevision) => captureProjectRevision() === expectedProjectRevision
    );
    configureRuntimeGraphTopologyValidator(runtimeGraphTopology.matchesCurrentProject);
    commandBatchPreflightPort.setProvider(({ projectDocument, targetIds }) => {
<<<<<<< HEAD
        const documentFingerprints = captureCommandTargetFingerprints({
            document: projectDocument ?? getCrdtDoc('root'),
            targetIds,
        });
        const liveFingerprints = captureCommandTargetFingerprints({
            document: { projectContext: getProjectContext() },
            targetIds,
        });
        const targetFingerprints = Object.fromEntries(
            targetIds.flatMap((targetId) => {
                const documentFingerprint = documentFingerprints[targetId];
                if (documentFingerprint === undefined) {
                    return [];
                }
                const liveFingerprint = liveFingerprints[targetId];
                return [
                    [
                        targetId,
                        liveFingerprint === undefined
                            ? documentFingerprint
                            : JSON.stringify({ advertised: liveFingerprint, document: documentFingerprint }),
                    ],
                ];
            })
        );
        if (targetIds.includes('master') && targetFingerprints.master === undefined) {
            targetFingerprints.master = 'system-output:master';
        }
        if (targetIds.includes('hw_out')) {
            targetFingerprints.hw_out = 'system-output:hw_out';
=======
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
>>>>>>> origin/main
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
    configureRuntimeGraphProjectRevisionValidator(null);
    configureRuntimeGraphTopologyValidator(null);
}
