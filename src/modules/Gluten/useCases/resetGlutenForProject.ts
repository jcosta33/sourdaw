import { glutenMeterStore, glutenStore } from '../stores/glutenStore';

/**
 * End every Gluten instance at a project switch. Instances are keyed by device
 * id and ids are reused across projects, so a surviving entry would leak the
 * previous project's patch into the next one (§13.1).
 */
export function resetGlutenForProject(): void {
    glutenStore.set({});
    // Gluten holds high-frequency meter telemetry in a separate store from the
    // patch (like Grinder's grinderTelemetryStore); reset it too so a reopened
    // panel for a reused deviceId does not show the prior project's last meter
    // readings.
    glutenMeterStore.set({});
}
