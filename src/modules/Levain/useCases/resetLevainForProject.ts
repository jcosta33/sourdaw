import { levainStore } from '../stores/levainStore';

/**
 * End every Levain instance at a project switch, so no device state from the
 * previous project leaks into a same-id device of the next one (§13.1).
 */
export function resetLevainForProject(): void {
    levainStore.set({});
}
