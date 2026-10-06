import { type MeasurementRun, type MeasurementStopReason } from '../models/MeasurementBudget';

type ReducedTargets<Reduced> =
    { status: 'reduced'; reduced: Reduced[] } | { status: 'stopped'; reason: MeasurementStopReason };

/** Lets a pending cancel or deadline run its handlers before the next target's reduction starts. */
function yieldToEventLoop(): Promise<void> {
    return new Promise((resolve) => {
        setTimeout(resolve, 0);
    });
}

/**
 * Reduce each measured target in turn, counting each against the run and stopping at the first
 * target the run may no longer reduce. A reduction is synchronous, so the checks sit before it and
 * the loop yields between targets: that is the only place a cancel or the deadline can land.
 */
export async function reduceMeasuredTargets<Target, Reduced>(input: {
    targets: readonly Target[];
    run: MeasurementRun;
    reduce: (target: Target) => Reduced;
}): Promise<ReducedTargets<Reduced>> {
    const reduced: Reduced[] = [];
    for (const [index, target] of input.targets.entries()) {
        if (index > 0) {
            await yieldToEventLoop();
        }
        const reason = input.run.stopReason();
        if (reason !== null) {
            return { status: 'stopped', reason };
        }
        reduced.push(input.reduce(target));
        input.run.countAnalysis();
    }
    return { status: 'reduced', reduced };
}
