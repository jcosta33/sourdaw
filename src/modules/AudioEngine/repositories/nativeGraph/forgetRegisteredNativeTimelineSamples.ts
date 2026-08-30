/**
 * Forget what the native timeline sample pool is believed to hold (#3068).
 *
 * For tests, which share one module registry across cases and would otherwise
 * inherit a previous case's belief about a pool their transport never saw — a
 * registration silently skipped, and a `schedule-clip` naming a sample the
 * addon does not hold.
 */

import { registeredNativeTimelineSampleIds } from './registeredNativeTimelineSampleIds';

export function forgetRegisteredNativeTimelineSamples(): void {
    registeredNativeTimelineSampleIds.clear();
}
