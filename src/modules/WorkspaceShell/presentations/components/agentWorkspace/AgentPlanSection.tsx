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

type AgentPlanAudibleView =
    | { status: 'not-claimed'; reason: string }
    | {
          status: 'measured';
          metrics: ReadonlyArray<{
              targetId: string;
              targetKind: 'master' | 'track' | 'bus';
              range: { startBeat: number; endBeat: number; sectionId: string | null };
              metricId: string;
              baseline: MeasuredFigureView;
              preview: MeasuredFigureView;
              delta: MeasuredFigureView;
          }>;
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

function renderAudibleImpact(audible: AgentPlanAudibleView, tracks: AgentPlanSectionProps['tracks']): ReactElement {
    if (audible.status === 'not-claimed') {
        return <p className="text-xs text-muted-foreground">{`Audible impact ${audible.status}: ${audible.reason}`}</p>;
    }
    const lineCount = new Map<string, number>();
    const sectionsByBeats = new Map<string, Set<string>>();
    for (const metric of audible.metrics) {
        const key = `${metric.targetId}\u0000${metric.metricId}`;
        lineCount.set(key, (lineCount.get(key) ?? 0) + 1);
        const beats = `${key}\u0000${formatBeatRange(metric.range)}`;
        sectionsByBeats.set(beats, (sectionsByBeats.get(beats) ?? new Set<string>()).add(metric.range.sectionId ?? ''));
    }
    return (
        <>
            <p className="text-xs text-muted-foreground">Audible impact measured</p>
            <ul aria-label="Measured audible impact" className="list-inside list-disc text-xs text-foreground">
                {audible.metrics.map((metric) => {
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
