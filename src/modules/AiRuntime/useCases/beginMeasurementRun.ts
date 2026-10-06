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
    /** Seconds each of the measurement's renders processes; with the planned render jobs it sets the wall-clock allowance. */
    renderedSeconds: number;
};

type BeginMeasurementRunResult =
    { status: 'refused'; failure: MeasurementFailure } | { status: 'started'; run: MeasurementRun };

/**
 * Admits one planner measurement against the run's budgets and bounds its duration. The signal the
 * renders read joins the run's cancellation with a wall-clock deadline, and `stopReason` tells the
 * two apart, so a user's cancel never reads as a timeout. The deadline allows four times the total
 * seconds all the measurement's renders process, so a preview's two renders per target and a
 * four-target project measurement are not held to the time of one render.
 */
export function beginMeasurementRun(input: BeginMeasurementRunInput): BeginMeasurementRunResult {
    const admission = input.admit?.(input.planned);
    if (admission?.status === 'refused') {
        return { status: 'refused', failure: describeMeasurementBudgetRefusal(admission.category) };
    }
    const deadline = new AbortController();
    const deadlineTimer = setTimeout(
        () => {
            deadline.abort();
        },
        resolveMeasurementWallClockMs({
            renderedSeconds: input.renderedSeconds,
            renderJobs: input.planned.renderJobs,
            ceilingMs: readAgentResourceLimits().measurementWallClockMs,
        })
    );
    const signal =
        input.runSignal === undefined ? deadline.signal : AbortSignal.any([input.runSignal, deadline.signal]);
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
                return deadline.signal.aborted ? 'timed-out' : null;
            },
            settle: () => {
                clearTimeout(deadlineTimer);
                if (admission?.status === 'admitted') {
                    admission.settle({ renderJobs, analyses });
                }
            },
        },
    };
}
