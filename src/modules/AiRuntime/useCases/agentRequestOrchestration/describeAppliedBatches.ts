/** Which earlier batches of a schedule stay applied when the batch at `position` stops the run. */
export function describeAppliedBatches(position: number): string {
    return position === 2 ? 'Batch 1 remains applied.' : `Batches 1–${String(position - 1)} remain applied.`;
}
