import { carryTeardownReads } from './carryTeardownReads';
import { warnLiveStatesLost } from './warnLiveStatesLost';

import type { TeardownStateReads } from './readLiveStatesForTeardown';

/** Carry a teardown's reads and warn about the plugins it lost; see `carryTeardownReads`. */
export function commitCarriedLiveStates(reads: TeardownStateReads, tornDownInstanceIds: Iterable<string>): void {
    warnLiveStatesLost(carryTeardownReads(reads, tornDownInstanceIds));
}
