import { projectStore } from '../../../stores/projectStore';

/**
 * Raise the Project-owned barrier that says this session is not on disk yet.
 *
 * Every project replacement publishes its stores before its bundle is durable,
 * so a failed initial snapshot or a reset that could not finalize leaves a
 * clean-looking projection over storage that still holds the previous project.
 * A durable-recovery caller must not close that session, and only the normal
 * save path clears the barrier again.
 */
export function markProjectDurabilityPending(): void {
    const project = projectStore.value;
    if (project) {
        projectStore.set({ ...project, identityPersistencePending: true });
    }
}
