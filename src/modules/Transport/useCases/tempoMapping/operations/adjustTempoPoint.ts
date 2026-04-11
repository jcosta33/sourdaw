import { type TempoMapPoint } from '#/modules/Transport/models/TempoMappingTypes';

/**
 * Manually adjust a tempo map point.
 */
export function adjustTempoPoint(points: TempoMapPoint[], beat: number, newBpm: number): TempoMapPoint[] {
    return points.map((p) => (p.beat === beat ? { ...p, bpm: newBpm, manual: true, confidence: 1 } : p));
}