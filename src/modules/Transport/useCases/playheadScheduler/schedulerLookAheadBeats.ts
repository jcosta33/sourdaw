import { SCHEDULE_AHEAD_SECONDS } from './projectLoopSeamWindow';

/** Prepared MIDI lookup compares endpoints exactly, so first and rolling ticks share this IEEE-754 operation order. */
export function schedulerLookAheadBeats(tempoBpm: number): number {
    return SCHEDULE_AHEAD_SECONDS * (tempoBpm / 60);
}
