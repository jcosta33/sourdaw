import { describeAgentRunHardLimit } from './AgentResourceLimits';
import {
    ANALYSIS_MEASURE_MIN_WALL_CLOCK_MS,
    ANALYSIS_MEASURE_WALL_CLOCK_MS_PER_RENDERED_SECOND,
} from './AnalysisMeasureLimits';

/** What one planner measurement spends: offline renders and target reductions. */
export type MeasurementWork = { renderJobs: number; analyses: number };

/**
 * A run's answer to a measurement asking to start. An admitted measurement owes `settle` the work it
 * actually did, on every outcome, so the run's budget ends at what ran rather than at what was planned.
 */
export type MeasurementAdmission =
    { status: 'admitted'; settle: (actual: MeasurementWork) => void } | { status: 'refused'; category: string };

export type MeasurementAdmitter = (planned: MeasurementWork) => MeasurementAdmission;

export type MeasurementStopReason = 'cancelled' | 'timed-out';

export type MeasurementFailure = { code: string; safeMessage: string; retryable: boolean };

/** One admitted measurement while it runs: what bounds it and the work it has done so far. */
export type MeasurementRun = {
    /** Aborts when the run is cancelled or the measurement's wall-clock allowance ends. */
    signal: AbortSignal;
    countRender: () => void;
    countAnalysis: () => void;
    /** Why the measurement must stop now, or `null` while it may go on. */
    stopReason: () => MeasurementStopReason | null;
    /** Reports the work that ran to the run's budget; owed on every outcome. */
    settle: () => void;
};

type MeasurementScope = { kind: 'master' | 'project' } | { kind: 'tracks' | 'buses'; ids: readonly string[] };

/**
 * The work one measurement will run. A preview renders every target twice, the project and the
 * preview, and reduces each target once, to the comparison of those two renders.
 */
export function planMeasurementWork(input: {
    scope: MeasurementScope;
    subject: 'project' | 'preview';
}): MeasurementWork {
    const targets = input.scope.kind === 'tracks' || input.scope.kind === 'buses' ? input.scope.ids.length : 1;
    return { renderJobs: input.subject === 'preview' ? targets * 2 : targets, analyses: targets };
}

/**
 * The wall-clock allowance of one measurement: four times the seconds it renders, never less than the
 * floor, and never more than the configured ceiling, which the floor does not override.
 */
export function resolveMeasurementWallClockMs(input: { renderedSeconds: number; ceilingMs: number }): number {
    const proportionalMs = Math.max(
        ANALYSIS_MEASURE_MIN_WALL_CLOCK_MS,
        input.renderedSeconds * ANALYSIS_MEASURE_WALL_CLOCK_MS_PER_RENDERED_SECOND
    );
    return Math.min(input.ceilingMs, proportionalMs);
}

export function describeMeasurementBudgetRefusal(category: string): MeasurementFailure {
    return {
        code: 'measurement-budget-exhausted',
        safeMessage: describeAgentRunHardLimit(category, 'measurement'),
        retryable: false,
    };
}

export function describeMeasurementStop(reason: MeasurementStopReason): MeasurementFailure {
    if (reason === 'timed-out') {
        return {
            code: 'measurement-timed-out',
            safeMessage:
                'The measurement ran past its wall-clock limit and was stopped; measure a shorter range or fewer targets.',
            retryable: true,
        };
    }
    return { code: 'cancelled', safeMessage: 'The measurement was cancelled.', retryable: false };
}
