function joinPositions(positions: readonly number[]): string {
    const last = positions.at(-1);
    if (positions.length < 2 || last === undefined) {
        return positions.join('');
    }
    return `${positions.slice(0, -1).join(', ')} and ${String(last)}`;
}

/**
 * Which earlier batches of a schedule stay applied when the batch at `position` stops the run: every
 * one before it, except the vibe-run batches the user skipped, which never reached the project.
 */
export function describeAppliedBatches(position: number, skippedPositions: readonly number[] = []): string {
    const applied = Array.from({ length: position - 1 }, (_, index) => index + 1).filter(
        (earlier) => !skippedPositions.includes(earlier)
    );
    if (applied.length === position - 1) {
        return position === 2 ? 'Batch 1 remains applied.' : `Batches 1–${String(position - 1)} remain applied.`;
    }
    return applied.length === 1 ? 'Only batch 1 remains applied.' : `Batches ${joinPositions(applied)} remain applied.`;
}
