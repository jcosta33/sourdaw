import { type ReactElement } from 'react';

import { Row, Stack } from '#/components/layout';
import { Button } from '#/components/ui/button';

/** The run projection fields this section renders, as a leaf-owned structural shape. */
type AgentRunControlsView = {
    runId: string;
    allowedActions: { cancel: boolean; retryWorkIds: readonly string[] };
    manualResumeReason: string | null;
    committedReceipts: readonly { workId: string; receiptIdentity: string; revertGroupId: string | null }[];
};

type AgentRunControlsSectionProps = {
    controls: AgentRunControlsView | null;
    /** History group ids a revert is still available for; a receipt outside it can only report that. */
    revertableGroupIds: readonly string[];
    onCancelRun: (runId: string) => void;
    onRevertGroup: (groupId: string) => void;
};

export const AgentRunControlsSection = ({
    controls,
    revertableGroupIds,
    onCancelRun,
    onRevertGroup,
}: AgentRunControlsSectionProps): ReactElement | null => {
    if (controls === null) {
        return null;
    }

    return (
        <Stack as="section" gap={2} aria-label="Run controls">
            <h4 className="text-xs font-semibold text-foreground">Run controls</h4>
            <Row gap={1}>
                <Button
                    type="button"
                    size="xs"
                    variant="secondary"
                    aria-label="Cancel agent run"
                    disabled={!controls.allowedActions.cancel}
                    className="motion-reduce:transition-none"
                    onClick={() => onCancelRun(controls.runId)}
                >
                    Cancel run
                </Button>
            </Row>
            {controls.manualResumeReason === null ? null : (
                <p className="text-xs text-muted-foreground">{controls.manualResumeReason}</p>
            )}
            <h5 className="text-xs font-semibold text-foreground">Eligible retries</h5>
            {controls.allowedActions.retryWorkIds.length === 0 ? (
                <p className="text-xs text-muted-foreground">None</p>
            ) : (
                <ul aria-label="Eligible retries" className="list-inside list-disc text-xs text-foreground">
                    {controls.allowedActions.retryWorkIds.map((workId) => (
                        <li key={workId}>{workId}</li>
                    ))}
                </ul>
            )}
            <h5 className="text-xs font-semibold text-foreground">Committed receipts</h5>
            {controls.committedReceipts.length === 0 ? (
                <p className="text-xs text-muted-foreground">None</p>
            ) : (
                <ul aria-label="Committed receipts" className="flex flex-col gap-1 text-xs">
                    {controls.committedReceipts.map((receipt) => {
                        const revertGroupId = receipt.revertGroupId;
                        const revertable = revertGroupId !== null && revertableGroupIds.includes(revertGroupId);

                        return (
                            <li key={receipt.workId}>
                                <Row justify="between" gap={2} className="min-w-0">
                                    <span className="min-w-0 truncate text-foreground">{receipt.receiptIdentity}</span>
                                    {revertGroupId === null ? null : (
                                        <Button
                                            type="button"
                                            size="xs"
                                            variant="ghost"
                                            aria-label={`Revert receipt ${receipt.workId}`}
                                            disabled={!revertable}
                                            className="motion-reduce:transition-none"
                                            onClick={() => onRevertGroup(revertGroupId)}
                                        >
                                            {revertable ? 'Revert' : 'Revert unavailable'}
                                        </Button>
                                    )}
                                </Row>
                            </li>
                        );
                    })}
                </ul>
            )}
        </Stack>
    );
};
