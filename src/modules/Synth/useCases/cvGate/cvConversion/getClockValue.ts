/** Generate a clock signal value (square wave) at the given tempo and time. Pure function. */
export function getClockValue(bpm: number, timeSec: number, division: number = 1): number {
    const pulsePerSec = (bpm / 60) * division;
    const phase = (timeSec * pulsePerSec) % 1;
    return phase < 0.5 ? 1 : 0;
}
