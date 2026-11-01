import { captureEventPositionAt } from './captureEventBeat';

export function captureEventBeatAt(input: { audioTime: number }): number {
    return captureEventPositionAt(input).beat;
}
