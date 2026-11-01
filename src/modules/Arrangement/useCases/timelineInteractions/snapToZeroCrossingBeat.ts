import { type Clip } from '../../stores/trackStore';

import { resolveZeroCrossingPosition } from './snapToZeroCrossing';

export function snapToZeroCrossing(clip: Clip, beat: number): number {
    return resolveZeroCrossingPosition(clip, beat).beat;
}
