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
    //
    // Distances are compared in step units, not beats: multiplying each candidate
    // by gridSize before comparing folds in the grid's own division rounding
    // error, which can flip an exact midpoint on a non-dyadic grid (e.g. 1/3).
    // Step units cancel that error because the note and both candidates share
    // the same division by gridSize.
    const stepUnits = beat / gridSize;
    const swingOffsetUnits = swing / 2;

    const nearestEvenStep = 2 * Math.round(stepUnits / 2);
    const nearestOddStep = 2 * Math.round((stepUnits - swingOffsetUnits - 1) / 2) + 1;
    const oddStepUnits = nearestOddStep + swingOffsetUnits;

    const evenDistance = Math.abs(stepUnits - nearestEvenStep);
    const oddDistance = Math.abs(stepUnits - oddStepUnits);

    let chosenStepUnits = nearestEvenStep;
    if (oddDistance < evenDistance) {
        chosenStepUnits = oddStepUnits;
    } else if (oddDistance === evenDistance) {
        // An exact tie goes to the later point, matching Math.round's own half-up rule.
        chosenStepUnits = Math.max(nearestEvenStep, oddStepUnits);
    }

    const target = chosenStepUnits * gridSize;

    return beat + (target - beat) * strength;
}
