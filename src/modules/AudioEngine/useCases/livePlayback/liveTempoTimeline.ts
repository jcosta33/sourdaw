import { readSecondsAtBeat, readTempoAtBeat } from '#/modules/Transport/stores';

/**
 * The tempo map comp resolution reads: song seconds at a beat, and the flat
 * tempo governing it. It is the map the readers convert each resolved offset
 * against, so a render hands in its own.
 */
export type ResolutionTempoTimeline = {
    secondsAtBeat: (beat: number) => number;
    tempoAtBeat: (beat: number) => number;
};

/**
 * The session's own tempo map, for live producers that resolve the comped
 * clip set without a render map of their own.
 */
export const liveTempoTimeline: ResolutionTempoTimeline = {
    secondsAtBeat: (beat) => readSecondsAtBeat({ beat }),
    tempoAtBeat: (beat) => readTempoAtBeat({ beat }),
};
