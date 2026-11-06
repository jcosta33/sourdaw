import { crustMeterStore, crustStore } from '../stores/crustStore';

/**
 * End every Crust instance at a project switch. Crust is per-device like
 * Gluten: clear both the patch instances and the meter telemetry, so no
 * previous project's patch or readings survive a device-id reuse (§13.1).
 */
export function resetCrustForProject(): void {
    crustStore.set({});
    crustMeterStore.set({});
}
