/**
 * Drop one backend's claim on the native sample bank store (#4203).
 *
 * A disposed backend names nothing: it sends no further batch, so its entry in
 * `claimedNativeSampleBankKeysByBackend` would otherwise sit there forever,
 * shielding every key it once named from a replacement anywhere else. Dropping
 * the entry releases nothing on its own — a key stays believed committed in
 * `registeredNativeSampleBankKeys` until the next `replaceTopology` batch
 * reclaims it — it only stops this backend's stale claim from being counted
 * among the backends a later release consults.
 */

import { claimedNativeSampleBankKeysByBackend } from './registeredNativeSampleBankKeys';

export function releaseNativeSampleBankClaims(backendId: string): void {
    claimedNativeSampleBankKeysByBackend.delete(backendId);
}
