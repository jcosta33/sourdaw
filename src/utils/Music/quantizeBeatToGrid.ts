type QuantizeBeatToGridInput = {
    beat: number;
    gridSize: number;
    strength: number;
    swing: number;
};

export function quantizeBeatToGrid({ beat, gridSize, strength, swing }: QuantizeBeatToGridInput): number {
    // The swung grid interleaves two point sets: even steps stay on the straight
    // grid, odd steps are delayed by swing * gridSize / 2. Snap to whichever point
    // of that swung grid is nearest, not to the nearest straight step.
    const stepUnits = beat / gridSize;
    const swingOffsetUnits = swing / 2;

    const nearestEvenStep = 2 * Math.round(stepUnits / 2);
    const nearestOddStep = 2 * Math.round((stepUnits - swingOffsetUnits - 1) / 2) + 1;

    const evenTarget = nearestEvenStep * gridSize;
    const oddTarget = (nearestOddStep + swingOffsetUnits) * gridSize;

    const evenDistance = Math.abs(beat - evenTarget);
    const oddDistance = Math.abs(beat - oddTarget);

    let target = evenTarget;
    if (oddDistance < evenDistance) {
        target = oddTarget;
    } else if (oddDistance === evenDistance) {
        // An exact tie goes to the later point, matching Math.round's own half-up rule.
        target = Math.max(evenTarget, oddTarget);
    }

    return beat + (target - beat) * strength;
}
