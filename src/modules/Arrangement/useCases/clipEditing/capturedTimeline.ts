import { readTempoAtBeat, readSecondsAtBeat, readBeatAtSamples } from '#/modules/Transport/stores';
import { type TempoSourceClock } from '#/modules/Transport/stores';

import { type TempoTimeline } from '../../models/TempoTimeline';

export function capturedTimeline(clock: TempoSourceClock): TempoTimeline {
    return {
        tempoAtBeat: (beat) => readTempoAtBeat({ beat, clock }),
        secondsAtBeat: (beat) => readSecondsAtBeat({ beat, clock }),
        beatAtSeconds: (seconds) => readBeatAtSamples({ samples: seconds, sampleRate: 1, clock }),
    };
}
