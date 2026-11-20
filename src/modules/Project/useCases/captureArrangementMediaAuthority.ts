import { arrangementStore } from '../stores/arrangementStore';

import { captureProjectTransitionAuthority } from './projectPersistence/captureProjectTransitionAuthority';

/** A media choice belongs to the arrangement where it started, even after a switch back. */
export function captureArrangementMediaAuthority() {
    const project = captureProjectTransitionAuthority();
    const arrangementId = arrangementStore.value?.activeArrangementId;
    let arrangementIsCurrent = true;
    const dispose = arrangementStore.subscribe(() => {
        if (arrangementStore.value?.activeArrangementId !== arrangementId) {
            arrangementIsCurrent = false;
        }
    });
    return {
        isCurrent: (): boolean =>
            project.isCurrent() &&
            arrangementIsCurrent &&
            arrangementStore.value?.activeArrangementId === arrangementId,
        dispose,
    };
}
