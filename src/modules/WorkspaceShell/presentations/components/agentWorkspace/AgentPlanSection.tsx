import { type ReactElement } from 'react';

import { Stack } from '#/components/layout';

import { formatBeatRange, formatFigure, formatSignedDelta, measuredTargetName } from './measuredFigureText';

/**
 * The interpreted plan only. Provider reasoning is never part of this contract
 * and must not be rendered on any surface.
 */
type AgentPlanView = {
    objective: string;
    interpretedConstraints: readonly string[];
    steps: ReadonlyArray<{ order: number; actionType: string; description: string }>;
    expectedImpact: { project: readonly string[]; audible: AgentPlanAudibleView };
    risks: readonly string[];
    approvalPoints: ReadonlyArray<{ kind: string; reason: string }>;
    alternatives: ReadonlyArray<{ id: string; label: string }>;
    stoppingConditions: readonly string[];
};

type MeasuredFigureView = { value: number; unit: string };

type MeasuredMetricView = {
    targetId: string;
    targetKind: 'master' | 'track' | 'bus';
    range: { startBeat: number; endBeat: number; sectionId: string | null };
    metricId: string;
    baseline: MeasuredFigureView;
    preview: MeasuredFigureView;
    delta: MeasuredFigureView;
};

type PredictionView = {
    goalId: string;
    metricId: string | null;
    band: string | null;
    targetIds: readonly string[];
    referenceTargetIds: readonly string[];
    relation: string;
    targetValue: number | null;
    outcome: {
        baseline: readonly number[];
        observed: readonly number[];
        unit: string | null;
        status: 'verified' | 'blocked';
    } | null;
};

type AgentPlanAudibleView =
    | { status: 'not-claimed'; reason: string }
    | { status: 'measured'; metrics: ReadonlyArray<MeasuredMetricView> }
    | {
          status: 'predicted';
          predictions: ReadonlyArray<PredictionView>;
          verification: { status: 'verified' | 'blocked'; failure: string | null; reason: string | null } | null;
          observed:
              { status: 'listed'; metrics: ReadonlyArray<MeasuredMetricView> } | { status: 'omitted'; reason: string };
      };

type AgentPlanSectionProps = {
    plan: AgentPlanView | null;
    /** The live tracks, which name a measured target the way the approval card does. */
    tracks: ReadonlyArray<{ id: string; name: string }>;
};

function renderTextList(label: string, items: readonly string[]): ReactElement {
    if (items.length === 0) {
        return <p className="text-xs text-muted-foreground">{`${label}: none`}</p>;
    }
    return (
        <ul aria-label={label} className="list-inside list-disc text-xs text-foreground">
            {items.map((item) => (
                <li key={item}>{item}</li>
            ))}
        </ul>
    );
}

function renderMeasuredMetrics(
    metrics: ReadonlyArray<MeasuredMetricView>,
    tracks: AgentPlanSectionProps['tracks']
): ReactElement {
    const lineCount = new Map<string, number>();
    const sectionsByBeats = new Map<string, Set<string>>();
    for (const metric of metrics) {
        const key = `${metric.targetId}\u0000${metric.metricId}`;
        lineCount.set(key, (lineCount.get(key) ?? 0) + 1);
        const beats = `${key}\u0000${formatBeatRange(metric.range)}`;
        sectionsByBeats.set(beats, (sectionsByBeats.get(beats) ?? new Set<string>()).add(metric.range.sectionId ?? ''));
    }
    return (
        <ul aria-label="Measured audible impact" className="list-inside list-disc text-xs text-foreground">
            {metrics.map((metric) => {
                const name = measuredTargetName({
                    ...metric,
                    targetName: tracks.find((track) => track.id === metric.targetId)?.name ?? null,
                });
                const lineKey = `${metric.targetId}\u0000${metric.metricId}`;
                const beats = formatBeatRange(metric.range);
                // Equal beats over different sections read alike, so only then is the section named.
                const sameBeatsAcrossSections = (sectionsByBeats.get(`${lineKey}\u0000${beats}`)?.size ?? 0) > 1;
                let rangeLabel = beats;
                if (sameBeatsAcrossSections) {
                    rangeLabel = `${beats}, section ${metric.range.sectionId ?? 'none'}`;
                }
                const range = (lineCount.get(lineKey) ?? 0) > 1 ? ` (${rangeLabel})` : '';
                return (
                    <li
                        key={`${metric.targetId}-${metric.metricId}-${String(metric.range.startBeat)}-${String(metric.range.endBeat)}-${metric.range.sectionId ?? ''}`}
                    >
                        {`${name} ${metric.metricId}${range}: ${formatFigure(metric.baseline)} → ${formatFigure(metric.preview)} (${formatSignedDelta(metric.delta)})`}
                    </li>
                );
            })}
        </ul>
    );
}

function nameTargets(ids: readonly string[], tracks: AgentPlanSectionProps['tracks']): string {
    return ids
        .map((id) =>
            measuredTargetName({
                targetId: id,
                targetKind: id === 'master' ? 'master' : 'track',
                targetName: tracks.find((track) => track.id === id)?.name ?? null,
            })
        )
        .join(', ');
}

function describePredictedRelation(prediction: PredictionView, tracks: AgentPlanSectionProps['tracks']): string {
    const references = nameTargets(prediction.referenceTargetIds, tracks);
    switch (prediction.relation) {
        case 'increase':
        case 'decrease':
        case 'hold':
            return prediction.relation;
        case 'no-increase':
            return 'not increase';
        case 'no-decrease':
            return 'not decrease';
        case 'match-current':
            return `match ${references}`;
        case 'greater-than-current':
            return `exceed ${references}`;
        case 'less-than-current':
            return `stay below ${references}`;
        case 'target':
            return `reach ${String(prediction.targetValue)}`;
        default:
            return 'no supported direction';
    }
}

function describePredictionOutcome(
    outcome: PredictionView['outcome'],
    verification: Extract<AgentPlanAudibleView, { status: 'predicted' }>['verification']
): string {
    if (outcome === null || verification === null) {
        return 'awaiting preview';
    }
    const figures = (values: readonly number[]) => values.map((value) => value.toFixed(2)).join(', ');
    if (outcome.observed.length === 0) {
        return `not verified: ${verification.reason ?? verification.failure ?? 'no measurement'}`;
    }
    const unit = outcome.unit === null ? '' : ` ${outcome.unit}`;
    const moved = `${figures(outcome.baseline)}${unit} → ${figures(outcome.observed)}${unit}`;
    return outcome.status === 'verified' ? `held: ${moved}` : `did not hold: ${moved}`;
}

function renderPredictions(
    audible: Extract<AgentPlanAudibleView, { status: 'predicted' }>,
    tracks: AgentPlanSectionProps['tracks']
): ReactElement {
    const { verification } = audible;
    return (
        <>
            <p className="text-xs text-muted-foreground">Audible impact predicted</p>
            <ul aria-label="Predicted audible impact" className="list-inside list-disc text-xs text-foreground">
                {audible.predictions.map((prediction) => {
                    const metric = [prediction.metricId ?? 'metric', prediction.band].filter(Boolean).join(' ');
                    return (
                        <li key={prediction.goalId}>
                            {`${nameTargets(prediction.targetIds, tracks)} ${metric}: predicted to ${describePredictedRelation(prediction, tracks)}; ${describePredictionOutcome(prediction.outcome, verification)}`}
                        </li>
                    );
                })}
            </ul>
            {audible.observed.status === 'omitted' ? (
                <p className="text-xs text-muted-foreground">{`Measured: ${audible.observed.reason}`}</p>
            ) : null}
            {audible.observed.status === 'listed' && audible.observed.metrics.length > 0 ? (
                <>
                    <p className="text-xs text-muted-foreground">Measured</p>
                    {renderMeasuredMetrics(audible.observed.metrics, tracks)}
                </>
            ) : null}
        </>
    );
}

function renderAudibleImpact(audible: AgentPlanAudibleView, tracks: AgentPlanSectionProps['tracks']): ReactElement {
    if (audible.status === 'not-claimed') {
        return <p className="text-xs text-muted-foreground">{`Audible impact ${audible.status}: ${audible.reason}`}</p>;
    }
    if (audible.status === 'predicted') {
        return renderPredictions(audible, tracks);
    }
    return (
        <>
            <p className="text-xs text-muted-foreground">Audible impact measured</p>
            {renderMeasuredMetrics(audible.metrics, tracks)}
        </>
    );
}

export const AgentPlanSection = ({ plan, tracks }: AgentPlanSectionProps): ReactElement => {
    if (plan === null) {
        return (
            <Stack as="section" gap={1} aria-label="Plan">
                <h4 className="text-xs font-semibold text-foreground">Plan</h4>
                <p className="text-xs text-muted-foreground">No plan yet</p>
            </Stack>
        );
    }

    return (
        <Stack as="section" gap={2} aria-label="Plan">
            <h4 className="text-xs font-semibold text-foreground">Plan</h4>
            <p className="text-xs text-foreground">{plan.objective}</p>
            {renderTextList('Interpreted constraints', plan.interpretedConstraints)}
            <ol aria-label="Plan steps" className="list-inside list-decimal text-xs text-foreground">
                {plan.steps.map((step) => (
                    <li key={step.order}>{`${step.actionType}: ${step.description}`}</li>
                ))}
            </ol>
            {renderTextList('Expected impact', plan.expectedImpact.project)}
            {renderAudibleImpact(plan.expectedImpact.audible, tracks)}
            {renderTextList('Risks', plan.risks)}
            {plan.stoppingConditions.length === 0 ? null : (
                <ul aria-label="Stopping conditions" className="list-inside list-disc text-xs text-foreground">
                    {plan.stoppingConditions.map((condition, index) => (
                        <li key={`${String(index)}-${condition}`}>{condition}</li>
                    ))}
                </ul>
            )}
            <ul aria-label="Approval points" className="list-inside list-disc text-xs text-foreground">
                {plan.approvalPoints.map((point) => (
                    <li key={`${point.kind}-${point.reason}`}>{`${point.kind}: ${point.reason}`}</li>
                ))}
            </ul>
            <ul aria-label="Alternatives" className="list-inside list-disc text-xs text-foreground">
                {plan.alternatives.map((alternative) => (
                    <li key={alternative.id}>{alternative.label}</li>
                ))}
            </ul>
        </Stack>
    );
};
