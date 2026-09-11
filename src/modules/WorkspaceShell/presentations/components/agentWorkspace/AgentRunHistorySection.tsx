import { type ReactElement, type Ref } from 'react';

import { Row, Stack } from '#/components/layout';
import { Button } from '#/components/ui/button';

/** The action-history fields this section renders, as a leaf-owned structural shape. */
type AgentHistoryGroupView = {
    id: string;
    groupId: string;
    prompt: string;
    actions: readonly { actionType: string; label: string }[];
    timestamp: number;
    reverted: boolean;
    executionKind?: 'project' | 'runtime';
};

/** One group's comparison availability, keyed by `groupId` in the parent's map. */
type ComparisonAvailability = { available: true } | { available: false; reason: string };

type AgentRunHistorySectionProps = {
    /** Newest first; the parent owns the ordering the store does not guarantee. */
    groups: readonly AgentHistoryGroupView[];
    /** Keyed by `group.groupId`, never `group.id`: comparison targets the undoable group, not the history entry. */
    comparisonAvailability: Readonly<Record<string, ComparisonAvailability>>;
    onRevert: (groupId: string) => void;
    onCompare: (groupId: string) => void;
    /** Lets the parent query a specific Compare button by aria-label after ending a comparison. */
    ref?: Ref<HTMLElement>;
};

export const AgentRunHistorySection = ({
    groups,
    comparisonAvailability,
    onRevert,
    onCompare,
    ref,
}: AgentRunHistorySectionProps): ReactElement => {
    return (
        <Stack as="section" ref={ref} gap={2} aria-label="Agent change history">
            <h4 className="text-xs font-semibold text-foreground">Agent change history</h4>
            {groups.length === 0 ? <p className="text-xs text-muted-foreground">No agent changes yet</p> : null}
            {groups.map((group) => {
                const runtimeOnly = group.executionKind === 'runtime';
                const availability = comparisonAvailability[group.groupId] ?? { available: false, reason: '' };

                return (
                    <Stack key={group.id} gap={1} className="rounded border border-border/60 p-2 text-xs">
                        <Row justify="between" gap={2} className="min-w-0">
                            <span className="min-w-0 truncate text-foreground">{group.prompt}</span>
                            <Row gap={1}>
                                <Button
                                    type="button"
                                    size="xs"
                                    variant="ghost"
                                    aria-label={`Compare agent changes ${group.prompt}`}
                                    disabled={!availability.available}
                                    className="motion-reduce:transition-none"
                                    onClick={() => onCompare(group.groupId)}
                                >
                                    Compare
                                </Button>
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
                        </Row>
                        {availability.available ? null : <p className="text-muted-foreground">{availability.reason}</p>}
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
