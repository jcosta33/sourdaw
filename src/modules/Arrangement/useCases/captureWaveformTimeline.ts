import { createSamplePositionProjector, resolveTempoAtBeat, secondsBetweenBeats } from '#/modules/Transport/useCases';

import { type TempoTimeline } from '../models/TempoTimeline';

export function captureWaveformTimeline(
    tempo: number,
    changes: Parameters<typeof secondsBetweenBeats>[0]
): TempoTimeline {
    const capturedChanges = structuredClone(changes);
    const projectSamples = createSamplePositionProjector({
        transport: { tempo },
        tempoMap: { changes: [...capturedChanges] },
    });
    return {
        secondsAtBeat: (beat) => secondsBetweenBeats(capturedChanges, 0, beat, tempo),
        beatAtSeconds: (seconds) => projectSamples({ samples: seconds, sampleRate: 1 }),
        tempoAtBeat: (beat) => resolveTempoAtBeat({ changes: capturedChanges, beat, defaultTempo: tempo }),
    };
}
