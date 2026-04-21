import { getEnvelope } from '../../stores/gainEnvelopeStore';

export function getGainAtBeat(clipId: string, beatOffset: number): number {
    const env = getEnvelope(clipId);
    if (!env || !env.enabled || env.points.length === 0) {
        return 0;
    }

    const points = env.points;

    if (beatOffset <= points[0]!.beatOffset) {
        return points[0]!.gainDb;
    }

    if (beatOffset >= points[points.length - 1]!.beatOffset) {
        return points[points.length - 1]!.gainDb;
    }

    for (let index = 0; index < points.length - 1; index++) {
        const alpha = points[index]!;
        const buffer = points[index + 1]!;
        if (beatOffset >= alpha.beatOffset && beatOffset <= buffer.beatOffset) {
            const time = (beatOffset - alpha.beatOffset) / (buffer.beatOffset - alpha.beatOffset);
            return alpha.gainDb + time * (buffer.gainDb - alpha.gainDb);
        }
    }

    return 0;
}
