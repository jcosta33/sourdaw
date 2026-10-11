import { readBeatAtSamples, readSecondsAtBeat, readTempoAtBeat } from '#/modules/Transport/stores';

import { type TempoTimeline } from '../models/TempoTimeline';

/** The session's tempo map, the one the Web Audio scheduler converts every offset against. */
export const liveTempoTimeline: TempoTimeline = {
    secondsAtBeat: (beat) => readSecondsAtBeat({ beat }),
    beatAtSeconds: (seconds) => readBeatAtSamples({ samples: seconds, sampleRate: 1 }),
    tempoAtBeat: (beat) => readTempoAtBeat({ beat }),
};
