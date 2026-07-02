import { getGridSnap } from './getGridSnap';

export function snapToGrid(beat: number): number {
    const snap = getGridSnap();
    if (snap === 0) {
        return beat;
    }
    return Math.round(beat / snap) * snap;
}
