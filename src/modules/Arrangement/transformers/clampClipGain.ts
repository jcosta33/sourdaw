/** The gain a clip gain write actually lands on, which is what a replay guard must expect. */
export function clampClipGain(gain: number): number {
    return Math.max(0, Math.min(2, gain));
}
