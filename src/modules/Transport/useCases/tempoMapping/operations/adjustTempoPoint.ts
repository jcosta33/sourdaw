import { type TempoMapPoint } from '../../../models/TempoMappingTypes';

/**
 * Manually adjust a tempo map point.
 */
export function adjustTempoPoint(points: TempoMapPoint[], beat: number, newBpm: number): TempoMapPoint[] {
    return points.map((param) =>
        param.beat === beat ? { ...param, bpm: newBpm, manual: true, confidence: 1 } : param
    );
}
