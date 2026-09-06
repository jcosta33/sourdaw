import { type ReactElement, useEffect, useId, useRef } from 'react';

import { Row, Stack } from '#/components/layout';
import { Button } from '#/components/ui/button';

export type AgentRunDecisionControl = {
    runId: string;
    allowedActions: { resume: boolean };
    resumeRejectionReason: string | null;
    decision: {
        reason: string;
        alternatives: Array<{ id: string; label: string; changesAuthority: boolean }>;
    };
};

type AgentRunDecisionControlsProps = {
    decisions: AgentRunDecisionControl[];
    statusMessage: string | null;
    onResumeDecision: (runId: string, alternativeId: string) => void;
};

function getUnavailableReason(decision: AgentRunDecisionControl): string {
    return decision.resumeRejectionReason ?? 'The pending decision is unavailable or already consumed.';
}

export const AgentRunDecisionControls = ({
    decisions,
    statusMessage,
    onResumeDecision,
}: AgentRunDecisionControlsProps): ReactElement | null => {
    const firstAvailableControlRef = useRef<HTMLButtonElement>(null);
    const statusRef = useRef<HTMLParagraphElement>(null);
    const previousAvailableDecisionRef = useRef<string | null>(null);
    const decisionHeadingId = useId();
    const statusId = useId();
    const firstAvailableDecision = decisions.find((decision) => decision.allowedActions.resume) ?? null;

    useEffect(() => {
        if (firstAvailableDecision !== null && previousAvailableDecisionRef.current !== firstAvailableDecision.runId) {
            firstAvailableControlRef.current?.focus();
        }
        previousAvailableDecisionRef.current = firstAvailableDecision?.runId ?? null;
    }, [firstAvailableDecision]);

    useEffect(() => {
        if (statusMessage !== null) {
            statusRef.current?.focus();
        }
    }, [statusMessage]);

    if (decisions.length === 0) {
        return null;
    }

    return (
        <section
            aria-labelledby={decisionHeadingId}
            className="shrink-0 border-b border-amber-400/30 bg-amber-400/10 px-4 py-3 motion-reduce:transition-none"
        >
            <h2 id={decisionHeadingId} className="text-xs font-semibold text-foreground">
                Agent decision required
            </h2>
            <p
                ref={statusRef}
                id={statusId}
                role="status"
                aria-live="polite"
                aria-atomic="true"
                tabIndex={-1}
                className="mt-1 text-xs text-muted-foreground outline-none focus-visible:ring-1 focus-visible:ring-border-focus/70"
            >
                {statusMessage}
            </p>
            <Stack as="ul" gap={3} className="mt-2" aria-label="Pending agent decisions">
                {decisions.map((decision, decisionIndex) => {
                    const isAvailable = decision.allowedActions.resume;
                    const unavailableReason = isAvailable ? null : getUnavailableReason(decision);

                    return (
                        <li key={decision.runId} className="rounded border border-border/60 bg-surface-raised/80 p-2.5">
                            <p className="text-xs text-foreground">{decision.decision.reason}</p>
                            <Stack as="ul" gap={2} className="mt-2" aria-label="Decision alternatives">
                                {decision.decision.alternatives.map((alternative, alternativeIndex) => {
                                    const alternativeStatusId = `${statusId}-alternative-${decisionIndex}-${alternativeIndex}`;

                                    return (
                                        <Row as="li" key={alternative.id} justify="between" gap={2}>
                                            <span className="text-xs text-foreground">{alternative.label}</span>
                                            <Button
                                                ref={
                                                    isAvailable &&
                                                    alternativeIndex === 0 &&
                                                    firstAvailableDecision?.runId === decision.runId
                                                        ? firstAvailableControlRef
                                                        : undefined
                                                }
                                                type="button"
                                                size="xs"
                                                variant={isAvailable ? 'secondary' : 'ghost'}
                                                disabled={!isAvailable}
                                                aria-describedby={`${statusId} ${alternativeStatusId}`}
                                                aria-label={`Select ${alternative.label}`}
                                                data-state={isAvailable ? 'available' : 'unavailable'}
                                                onClick={() => onResumeDecision(decision.runId, alternative.id)}
                                            >
                                                Select
                                            </Button>
                                            <span id={alternativeStatusId} className="sr-only">
                                                {isAvailable
                                                    ? 'Available. Select this alternative to resume the agent run.'
                                                    : `Unavailable: ${unavailableReason}`}
                                            </span>
                                        </Row>
                                    );
                                })}
                            </Stack>
                            {!isAvailable ? (
                                <p className="mt-2 text-xs text-muted-foreground">Unavailable: {unavailableReason}</p>
                            ) : null}
                        </li>
                    );
                })}
            </Stack>
        </section>
    );
};
