/**
 * Correct the devices of every instance a batch reported the engine took over,
 * and splice those instances into the chains that name them.
 *
 * A plugin loaded before the engine was running is held by the command layer
 * with no engine behind it, and its device was told exactly that: loaded, and
 * passing silence. Nothing else ever revises that answer — the instance is
 * attached natively and processing audio, while the app still shows it degraded
 * for the rest of the session.
 *
 * Every apply, not only the one that starts the engine. A batch reserves ring
 * slots for the instances it counted and the native attach takes no more than
 * that, so an instance parked while a batch was in flight is taken by the next
 * one — within a single start sequence that is the roll, one batch behind the
 * topology. Which batch carries the correction is the native side's business;
 * this module's business is that no route drops it.
 *
 * The splice is the rolling half of the same fact (#3575). Parked, the next
 * play's topology batch is built against the attach state written just above
 * and binds the instance by itself. Rolling, no such batch is coming: the strip
 * went out with no body for that device, and only a chain edit puts one there.
 */

import { type AudioGraphApplyResult } from '../../models/AudioGraphBackend';

import { markAttachedInstances } from './markAttachedInstances';
import { spliceInstancesAttachedBy } from './spliceInstancesAttachedBy';

export function reportAttachedPlugins(result: AudioGraphApplyResult): void {
    markAttachedInstances(result);
    spliceInstancesAttachedBy(result);
}
