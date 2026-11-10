import { commitRedoInverseCapture } from '#/modules/Command/useCases';
import { captureDurableDocumentWitness, captureProjectIdentity } from '#/modules/CrdtDocument/useCases';
import { type AppAction, type GeneratedMidiStateGuard, type HandlerValidationContext } from '#/utils/handlerContract';

import { captureClipReplayPublication } from './captureClipReplayPublication';

type Input = {
    recordedRedo: HandlerValidationContext['recordedRedo'];
    clipId: string;
    guard: GeneratedMidiStateGuard;
};

/** Stage the creator's own prefix with every paired capture in the same publication. */
export function prepareCreatedClipRedoGuard({
    recordedRedo,
    clipId,
    guard,
}: Input): ((action: AppAction) => void) | undefined {
    const inverse = recordedRedo?.inverseAction;
    if (!recordedRedo?.isCurrent() || inverse?.type !== 'discardDuplicatedClip' || inverse.payload.clipId !== clipId) {
        return undefined;
    }
    return (action) => {
        if (!recordedRedo.isCurrent()) {
            return;
        }
        commitRedoInverseCapture({
            phase: 'stage',
            action,
            inverseAction: {
                ...inverse,
                payload: { ...inverse.payload, generatedMidiStateGuard: structuredClone(guard) },
            },
            publicationAuthority: {
                captureIdentity: captureProjectIdentity,
                captureWitness: captureDurableDocumentWitness,
                captureOwnedPublication: captureClipReplayPublication,
            },
        });
    };
}
