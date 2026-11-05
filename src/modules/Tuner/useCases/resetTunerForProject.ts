import { tunerStore } from '../stores/tunerStore';

/**
 * End every Tuner instance at a project switch, so no device state from the
 * previous project leaks into a same-id device of the next one (§13.1).
 */
export function resetTunerForProject(): void {
    tunerStore.set({});
}
