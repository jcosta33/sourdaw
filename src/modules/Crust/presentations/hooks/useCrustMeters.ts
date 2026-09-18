import { useSyncExternalStore } from 'react';

import { type CrustMeterState, INITIAL_METERS, crustMeterStore } from '../../stores/crustStore';

/**
 * Subscribe to a single device's meter telemetry. A tick on another device
 * leaves this device's slice referentially unchanged, so React bails out of the
 * re-render for panels that did not tick.
 *
 * Lives in the presentation layer (not the store) so the store stays React-free:
 * `crustMeterStore`, `getCrustMeters`, `updateCrustMeters`, and the
 * `CrustMeterState`/`INITIAL_METERS` shape are plain state; this hook is the
 * only React binding over them.
 */
export function useCrustMeters(deviceId: string): CrustMeterState {
    return useSyncExternalStore(
        crustMeterStore.subscribeReact,
        () => crustMeterStore.value?.[deviceId] ?? INITIAL_METERS
    );
}
