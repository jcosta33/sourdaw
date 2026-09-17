/**
 * Forget the pedals latched under the project being left (#3998).
 *
 * The latch is per project: track and device ids outlive one, so a damper held
 * as a load, a new project or a template commits would be pressed onto the
 * first native body the next project builds. The project-leaving use cases call
 * this at their commit point — once the CRDT authority has been replaced and
 * the old project can no longer come back.
 *
 * A graph reset is not that point. `resetAudioGraph` also runs inside one
 * project, for a runtime repair and on the pre-commit teardown an abort then
 * restores, and forgetting there would bring the rebuilt bodies up with their
 * pedals raised while the player's foot is still down.
 */

import { forgetLatchedLiveMidiControls } from '../../services/liveMidiControlLatch';

export function forgetProjectLatchedPedals(): void {
    forgetLatchedLiveMidiControls();
}
