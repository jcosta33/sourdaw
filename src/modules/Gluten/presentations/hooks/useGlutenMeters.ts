import { useSyncExternalStore } from 'react';

import { type GlutenMeters, DEFAULT_GLUTEN_METERS, glutenMeterStore } from '../../stores/glutenStore';

/**
 * Subscribe to a single device's meter telemetry. A tick on another device
 * leaves this device's slice referentially unchanged, so React bails out of the
 * re-render for panels that did not tick.
 *
 * Lives in the presentation layer (not the store) so the store stays React-free:
 * `glutenMeterStore`, `getGlutenMeters`, `updateGlutenMeters`, and the
 * `GlutenMeters`/`DEFAULT_GLUTEN_METERS` shape are plain state; this hook is the
 * only React binding over them.
 */
export function useGlutenMeters(deviceId: string): GlutenMeters {
    return useSyncExternalStore(
        glutenMeterStore.subscribeReact,
        () => glutenMeterStore.value?.[deviceId] ?? DEFAULT_GLUTEN_METERS
    );
}
