import { type ReactElement } from 'react';

import { Row, Stack } from '#/components/layout';
import { Button } from '#/components/ui/button';

/** The action-history fields this section renders, as a leaf-owned structural shape. */
type AgentHistoryGroupView = {
    id: string;
    prompt: string;
    actions: readonly { actionType: string; label: string }[];
    timestamp: number;
    reverted: boolean;
    executionKind?: 'project' | 'runtime';
};

type AgentRunHistorySectionProps = {
    /** Newest first; the parent owns the ordering the store does not guarantee. */
    groups: readonly AgentHistoryGroupView[];
    onRevert: (groupId: string) => void;
};

export const AgentRunHistorySection = ({ groups, onRevert }: AgentRunHistorySectionProps): ReactElement => {
    return (
        <Stack as="section" gap={2} aria-label="Agent change history">
            <h4 className="text-xs font-semibold text-foreground">Agent change history</h4>
            {groups.length === 0 ? <p className="text-xs text-muted-foreground">No agent changes yet</p> : null}
            {groups.map((group) => {
                const runtimeOnly = group.executionKind === 'runtime';

                return (
                    <Stack key={group.id} gap={1} className="rounded border border-border/60 p-2 text-xs">
                        <Row justify="between" gap={2} className="min-w-0">
                            <span className="min-w-0 truncate text-foreground">{group.prompt}</span>
                            <Button
                                type="button"
                                size="xs"
                                variant="ghost"
                                aria-label={`Revert agent changes ${group.prompt}`}
                                disabled={group.reverted || runtimeOnly}
                                className="motion-reduce:transition-none"
                                onClick={() => onRevert(group.id)}
                            >
                                Revert
                            </Button>
                        </Row>
                        <ul
                            aria-label={`Actions for ${group.prompt}`}
                            className="list-inside list-disc text-foreground"
                        >
                            {group.actions.map((action) => (
                                <li key={`${action.actionType}-${action.label}`}>{action.label}</li>
                            ))}
                        </ul>
                        <p className="text-muted-foreground">{new Date(group.timestamp).toISOString()}</p>
                        <p className="text-muted-foreground" data-state={group.reverted ? 'reverted' : 'applied'}>
                            {group.reverted ? 'Reverted' : 'Applied'}
                        </p>
                    </Stack>
                );
            })}
        </Stack>
    );
};
