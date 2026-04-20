/** Convert MIDI velocity (0-127) to CV voltage. Pure function. */
export function velocityToCv(velocity: number, maxVoltage: number = 5): number {
    return (velocity / 127) * maxVoltage;
}
