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

    for (let i = 0; i < points.length - 1; i++) {
        const a = points[i]!;
        const b = points[i + 1]!;
        if (beatOffset >= a.beatOffset && beatOffset <= b.beatOffset) {
            const t = (beatOffset - a.beatOffset) / (b.beatOffset - a.beatOffset);
            return a.gainDb + t * (b.gainDb - a.gainDb);
        }
    }

    return 0;
}
