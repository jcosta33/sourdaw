import { type GeneratedMidiStateGuard, type HandlerValidationContext } from '#/utils/handlerContract';

type Input = {
    recordedRedo: HandlerValidationContext['recordedRedo'];
    clipId: string;
    guard: GeneratedMidiStateGuard;
};

/** Publish the creator's own prefix capture only after its replay commits. */
export function prepareCreatedClipRedoGuard({ recordedRedo, clipId, guard }: Input): (() => void) | undefined {
    const inverse = recordedRedo?.inverseAction;
    if (!recordedRedo?.isCurrent() || inverse?.type !== 'discardDuplicatedClip' || inverse.payload.clipId !== clipId) {
        return undefined;
    }
    return () => {
        if (recordedRedo.isCurrent()) {
            inverse.payload.generatedMidiStateGuard = structuredClone(guard);
        }
    };
}
