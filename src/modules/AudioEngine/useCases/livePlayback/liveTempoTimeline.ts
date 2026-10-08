import { readBeatAtSamples, readSecondsAtBeat, readTempoAtBeat } from '#/modules/Transport/stores';

/**
 * The tempo map comp resolution reads: song seconds at a beat, its inverse,
 * and the flat tempo governing a beat. It is the map the readers convert each
 * resolved offset against, so a render hands in its own.
 */
export type ResolutionTempoTimeline = {
    secondsAtBeat: (beat: number) => number;
    beatAtSeconds: (seconds: number) => number;
    tempoAtBeat: (beat: number) => number;
};

/**
 * The session's own tempo map, for live producers that resolve the comped
 * clip set without a render map of their own.
 */
export const liveTempoTimeline: ResolutionTempoTimeline = {
    secondsAtBeat: (beat) => readSecondsAtBeat({ beat }),
    beatAtSeconds: (seconds) => readBeatAtSamples({ samples: seconds, sampleRate: 1 }),
    tempoAtBeat: (beat) => readTempoAtBeat({ beat }),
};
