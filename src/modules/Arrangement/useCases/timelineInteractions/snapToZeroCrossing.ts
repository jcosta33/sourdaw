import { snapSplitBeatToZeroCrossing as snapSplitBeatToZeroCrossingService } from '../../services/snapSplitBeatToZeroCrossing';
import { type Clip } from '../../stores/trackStore';

export function snapToZeroCrossing(clip: Clip, beat: number): number {
    return snapSplitBeatToZeroCrossingService(clip, beat);
}
