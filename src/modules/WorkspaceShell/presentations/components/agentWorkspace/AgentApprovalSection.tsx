import { type ReactElement } from 'react';

import { Row, Stack } from '#/components/layout';
import { Button } from '#/components/ui/button';

/** The pending-confirmation fields this section renders, as a leaf-owned structural shape. */
type AgentApprovalView = {
    id: string;
    actionLabels: readonly string[];
    affectedIds: readonly string[];
    protectedUnchanged: readonly { id: string; name: string }[];
    risk: { level: string; reason: string | null } | null;
    projectRevision: string;
    status: string;
    error: string | null;
};

type AgentApprovalSectionProps = {
    confirmations: readonly AgentApprovalView[];
    onConfirm: (confirmationId: string) => void;
    onCancel: (confirmationId: string) => void;
};

function formatRisk(risk: AgentApprovalView['risk']): string {
    if (risk === null) {
        return 'unclassified';
    }
    if (risk.reason === null) {
        return risk.level;
    }
    return `${risk.level}: ${risk.reason}`;
}

export const AgentApprovalSection = ({
    confirmations,
    onConfirm,
    onCancel,
}: AgentApprovalSectionProps): ReactElement => {
    return (
        <Stack as="section" gap={2} aria-label="Approvals">
            <h4 className="text-xs font-semibold text-foreground">Approvals</h4>
            {confirmations.length === 0 ? (
                <p className="text-xs text-muted-foreground">No approvals requested</p>
            ) : null}
            {confirmations.map((confirmation) => (
                <Stack
                    key={confirmation.id}
                    gap={1}
                    className="rounded border border-border/60 bg-surface-raised/80 p-2 text-xs"
                >
                    <ul aria-label="Proposed actions" className="list-inside list-disc text-foreground">
                        {confirmation.actionLabels.map((label) => (
                            <li key={label}>{label}</li>
                        ))}
                    </ul>
                    <p className="text-muted-foreground">{`Affected: ${confirmation.affectedIds.join(', ') || 'none'}`}</p>
                    <p className="text-muted-foreground">
                        {`Protected unchanged: ${confirmation.protectedUnchanged.map((object) => object.name).join(', ') || 'none'}`}
                    </p>
                    <p className="text-muted-foreground">{`Risk: ${formatRisk(confirmation.risk)}`}</p>
                    <p className="text-muted-foreground">{`Base revision: ${confirmation.projectRevision}`}</p>
                    <p className="text-foreground" data-state={confirmation.status}>
                        {`Status: ${confirmation.status}`}
                    </p>
                    {confirmation.error === null ? null : <p className="text-destructive">{confirmation.error}</p>}
                    {confirmation.status === 'proposed' ? (
                        <Row gap={1}>
                            <Button
                                type="button"
                                size="xs"
                                variant="secondary"
                                aria-label="Confirm agent actions"
                                className="motion-reduce:transition-none"
                                onClick={() => onConfirm(confirmation.id)}
                            >
                                Confirm
                            </Button>
                            <Button
                                type="button"
                                size="xs"
                                variant="ghost"
                                aria-label="Cancel agent actions"
                                className="motion-reduce:transition-none"
                                onClick={() => onCancel(confirmation.id)}
                            >
                                Cancel
                            </Button>
                        </Row>
                    ) : null}
                </Stack>
            ))}
        </Stack>
    );
};
