import { type TempoChange, getTempoAtBeat as modelGetTempoAtBeat } from '../../models/TempoMap';

/** Resolve tempo at a given beat. */
export function getTempoAtBeat(changes: TempoChange[], beat: number, defaultTempo: number): number {
    return modelGetTempoAtBeat(changes, beat, defaultTempo);
}