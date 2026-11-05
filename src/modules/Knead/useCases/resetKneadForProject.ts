import { defaultKneadState, kneadStore } from '../stores/kneadStore';

/**
 * Clear the pitch-edit state at a project switch. It is keyed by clip id, and
 * clip ids are not unique across projects, so a surviving entry could attach
 * itself to a clip of the next project (§13.1).
 */
export function resetKneadForProject(): void {
    kneadStore.set(defaultKneadState);
}
