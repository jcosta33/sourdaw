import { type ReactElement } from 'react';

import { Stack } from '#/components/layout';

/**
 * The interpreted plan only. Provider reasoning is never part of this contract
 * and must not be rendered on any surface.
 */
type AgentPlanView = {
    objective: string;
    interpretedConstraints: readonly string[];
    steps: ReadonlyArray<{ order: number; actionType: string; description: string }>;
    expectedImpact: { project: readonly string[]; audible: { status: string; reason: string } };
    risks: readonly string[];
    approvalPoints: ReadonlyArray<{ kind: string; reason: string }>;
    alternatives: ReadonlyArray<{ id: string; label: string }>;
};

type AgentPlanSectionProps = {
    plan: AgentPlanView | null;
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

export const AgentPlanSection = ({ plan }: AgentPlanSectionProps): ReactElement => {
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
            <p className="text-xs text-muted-foreground">
                {`Audible impact ${plan.expectedImpact.audible.status}: ${plan.expectedImpact.audible.reason}`}
            </p>
            {renderTextList('Risks', plan.risks)}
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
