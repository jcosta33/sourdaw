import { type Clip } from '../../stores/trackStore';
import { snapSplitBeatToZeroCrossing as snapSplitBeatToZeroCrossingService } from '../../services/snapSplitBeatToZeroCrossing';

export function snapToZeroCrossing(clip: Clip, beat: number): number {
    return snapSplitBeatToZeroCrossingService(clip, beat);
}
