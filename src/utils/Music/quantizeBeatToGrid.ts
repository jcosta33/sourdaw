type QuantizeBeatToGridInput = {
    beat: number;
    gridSize: number;
    strength: number;
    swing: number;
};

export function quantizeBeatToGrid({ beat, gridSize, strength, swing }: QuantizeBeatToGridInput): number {
    const stepIndex = Math.round(beat / gridSize);
    const isOffbeatStep = stepIndex % 2 !== 0;
    const target = stepIndex * gridSize + (isOffbeatStep ? (swing * gridSize) / 2 : 0);

    return beat + (target - beat) * strength;
}
