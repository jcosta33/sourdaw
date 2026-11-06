import { grinderStore } from '../stores/grinderStore';
import { grinderTelemetryStore } from '../stores/grinderTelemetryStore';

/**
 * End every Grinder instance at a project switch. The persistent patch state
 * and the volatile telemetry are both keyed per device instance and must not
 * leak across a New Project or a project load (§13.1).
 */
export function resetGrinderForProject(): void {
    grinderStore.set({});
    grinderTelemetryStore.set({});
}
