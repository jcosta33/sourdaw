import { schedulerSession } from './schedulerSession';

/**
 * Take ownership of the scheduler for the play now being pressed, before it
 * waits for anything.
 *
 * A pause commits `isPlaying: false` at once but defers `stopPlayheadScheduler`
 * behind its recording flush, and that continuation stands down when it finds
 * the transport playing again. A play landing in that window therefore inherits
 * a session whose worker is still posting ticks, and those ticks still pass
 * every liveness check they are given — the generation is intact and the flag is
 * true again — so they keep advancing the playhead and emitting the window the
 * incoming play is about to re-emit from the pause point. Bumping the generation
 * here retires that session the moment Play is pressed rather than at the end of
 * a hold. `startPlayheadScheduler` already does this for itself, so the
 * synchronous path needs nothing; only a play that waits before starting the
 * scheduler has to claim the session up front.
 */
export function claimSchedulerSession(): number {
    schedulerSession.generation += 1;
    return schedulerSession.generation;
}
