import {
    describeMeasurementBudgetRefusal,
    resolveMeasurementWallClockMs,
    type MeasurementAdmitter,
    type MeasurementFailure,
    type MeasurementRun,
    type MeasurementWork,
} from '../models/MeasurementBudget';
import { readAgentResourceLimits } from '../stores/agentResourceLimitsStore';

type BeginMeasurementRunInput = {
    /** The run's admission; absent for a caller outside a run, which spends no budget. */
    admit?: MeasurementAdmitter;
    planned: MeasurementWork;
    runSignal?: AbortSignal;
    /** Seconds the measurement's renders process, which sets its wall-clock allowance. */
    renderedSeconds: number;
};

type BeginMeasurementRunResult =
    { status: 'refused'; failure: MeasurementFailure } | { status: 'started'; run: MeasurementRun };

/**
 * Admits one planner measurement against the run's budgets and bounds its duration. The signal the
 * renders read joins the run's cancellation with a wall-clock deadline, and `stopReason` tells the
 * two apart, so a user's cancel never reads as a timeout.
 */
export function beginMeasurementRun(input: BeginMeasurementRunInput): BeginMeasurementRunResult {
    const admission = input.admit?.(input.planned);
    if (admission?.status === 'refused') {
        return { status: 'refused', failure: describeMeasurementBudgetRefusal(admission.category) };
    }
    const deadline = AbortSignal.timeout(
        resolveMeasurementWallClockMs({
            renderedSeconds: input.renderedSeconds,
            ceilingMs: readAgentResourceLimits().measurementWallClockMs,
        })
    );
    const signal = input.runSignal === undefined ? deadline : AbortSignal.any([input.runSignal, deadline]);
    let renderJobs = 0;
    let analyses = 0;
    return {
        status: 'started',
        run: {
            signal,
            countRender: () => {
                renderJobs += 1;
            },
            countAnalysis: () => {
                analyses += 1;
            },
            stopReason: () => {
                if (input.runSignal?.aborted === true) {
                    return 'cancelled';
                }
                return deadline.aborted ? 'timed-out' : null;
            },
            settle: () => {
                if (admission?.status === 'admitted') {
                    admission.settle({ renderJobs, analyses });
                }
            },
        },
    };
}
