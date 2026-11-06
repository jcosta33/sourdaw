import { resetGrandBouleStores } from '../stores/grandBouleStore';

/**
 * End every Grand Boule instance at a project switch, so no device state from
 * the previous project leaks into a same-id device of the next one (§13.1).
 */
export function resetGrandBouleForProject(): void {
    resetGrandBouleStores();
}
