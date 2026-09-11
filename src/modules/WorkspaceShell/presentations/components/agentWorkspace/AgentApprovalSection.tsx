import { type ReactElement, useState } from 'react';

import { Row, Stack } from '#/components/layout';
import { Button } from '#/components/ui/button';

type ApprovalIntentGroup = {
    id: string;
    summary: string;
    affectedTrackIds: readonly string[];
    estimatedAudioImpact: { level: string; summary: string };
    warnings: readonly string[];
    dependsOnGroupIds: readonly string[];
};

type ApprovalDestructiveChange = {
    classification: string;
    consequence: string;
    recovery: string;
};

/** The approval-projection fields this section renders, as a leaf-owned structural shape. */
type AgentApprovalView = {
    confirmationId: string;
    status: string;
    error: string | null;
    prompt: string;
    actionLabels: readonly string[];
    scope: {
        targetIds: readonly string[];
        protectedTargetIds: readonly string[];
        protectedRanges: readonly unknown[];
    };
    risk: { level: string; decision: string; reasons: readonly string[]; requiredTrustMode: string } | null;
    intentGroups: readonly ApprovalIntentGroup[];
    destructiveChanges: readonly ApprovalDestructiveChange[];
    partialAcceptance: { available: boolean; reason: string | null };
    freshness: { status: string; reason?: string };
    rePreview: { available: boolean; reason: string | null };
    consequences: Readonly<Record<string, boolean | number>> | null;
    budgets: Readonly<Record<string, number>> | null;
    cost: readonly { category: string; reserved: number; actual: number; provenance: string }[];
    dataDisclosure: { categories: readonly string[]; retention: Readonly<Record<string, string>> } | null;
    actor: { localActorId: string } | null;
    expiry: { revision: string };
    createdAt: number;
    resolvedAt: number | null;
};

type AgentApprovalSectionProps = {
    approvals: readonly AgentApprovalView[];
    onConfirm: (confirmationId: string) => void;
    onCancel: (confirmationId: string) => void;
    onRePreview: (confirmationId: string, selectedIntentGroupIds: readonly string[] | undefined) => void;
};

type ApprovalCardProps = Omit<AgentApprovalSectionProps, 'approvals'> & {
    view: AgentApprovalView;
    excludedGroupIds: readonly string[];
    onToggleGroup: (groupId: string, included: boolean) => void;
};

function transitiveDependencies(groups: readonly ApprovalIntentGroup[], groupId: string): Set<string> {
    const collected = new Set<string>();
    const pending = [groupId];
    while (pending.length > 0) {
        const current = pending.pop()!;
        const group = groups.find((candidate) => candidate.id === current);
        for (const dependency of group?.dependsOnGroupIds ?? []) {
            if (!collected.has(dependency)) {
                collected.add(dependency);
                pending.push(dependency);
            }
        }
    }
    return collected;
}

function transitiveDependents(groups: readonly ApprovalIntentGroup[], groupId: string): Set<string> {
    const collected = new Set<string>();
    const pending = [groupId];
    while (pending.length > 0) {
        const current = pending.pop()!;
        for (const group of groups) {
            if (group.dependsOnGroupIds.includes(current) && !collected.has(group.id)) {
                collected.add(group.id);
                pending.push(group.id);
            }
        }
    }
    return collected;
}

/**
 * Including a group carries its dependencies in with it and excluding one carries its dependents
 * out, so a submitted subset never asks for a change without the change it is built on.
 */
function nextExclusion(
    groups: readonly ApprovalIntentGroup[],
    excluded: readonly string[],
    groupId: string,
    included: boolean
): string[] {
    const next = new Set(excluded);
    const affected = included ? transitiveDependencies(groups, groupId) : transitiveDependents(groups, groupId);
    affected.add(groupId);
    for (const id of affected) {
        if (included) {
            next.delete(id);
        } else {
            next.add(id);
        }
    }
    return [...next];
}

function formatEntries(entries: Readonly<Record<string, boolean | number | string>> | null): string {
    if (entries === null) {
        return 'none';
    }
    const formatted = Object.entries(entries).map(([name, value]) => `${name}: ${String(value)}`);
    return formatted.length === 0 ? 'none' : formatted.join(', ');
}

function formatDisclosure(disclosure: AgentApprovalView['dataDisclosure']): string {
    if (disclosure === null) {
        return 'none';
    }
    return `${disclosure.categories.join(', ')} — retention ${formatEntries(disclosure.retention)}`;
}

function formatCost(cost: AgentApprovalView['cost']): string {
    if (cost.length === 0) {
        return 'none';
    }
    return cost
        .map((attempt) => `${attempt.category} ${attempt.actual}/${attempt.reserved} ${attempt.provenance}`)
        .join('; ');
}

function formatInstant(instant: number | null): string {
    return instant === null ? 'not resolved' : new Date(instant).toISOString();
}

function renderScope(scope: AgentApprovalView['scope']): ReactElement {
    return (
        <>
            <p className="text-muted-foreground">{`Scope: ${scope.targetIds.join(', ') || 'none'}`}</p>
            <p className="text-muted-foreground">{`Protected: ${scope.protectedTargetIds.join(', ') || 'none'}`}</p>
            <p className="text-muted-foreground">{`Protected ranges: ${String(scope.protectedRanges.length)}`}</p>
        </>
    );
}

function renderRisk(risk: AgentApprovalView['risk']): ReactElement {
    if (risk === null) {
        return <p className="text-muted-foreground">Risk: unclassified</p>;
    }
    return (
        <>
            <p className="text-muted-foreground">{`Risk: ${risk.level} — ${risk.decision}`}</p>
            <p className="text-muted-foreground">{`Reasons: ${risk.reasons.join('; ') || 'none'}`}</p>
            <p className="text-muted-foreground">{`Trust mode: ${risk.requiredTrustMode}`}</p>
        </>
    );
}

function renderIntentGroups(
    view: AgentApprovalView,
    excludedGroupIds: readonly string[],
    onToggleGroup: ApprovalCardProps['onToggleGroup']
): ReactElement {
    if (view.intentGroups.length === 0) {
        return <p className="text-muted-foreground">Intent groups: none</p>;
    }
    return (
        <ul aria-label="Intent groups" className="flex flex-col gap-1 text-foreground">
            {view.intentGroups.map((group) => (
                <li key={group.id} className="flex flex-col gap-0.5">
                    <label className="flex items-center gap-1">
                        <input
                            type="checkbox"
                            aria-label={`Include ${group.summary}`}
                            checked={!excludedGroupIds.includes(group.id)}
                            disabled={!view.partialAcceptance.available}
                            onChange={(event) => onToggleGroup(group.id, event.currentTarget.checked)}
                        />
                        <span>{group.summary}</span>
                    </label>
                    <span className="text-muted-foreground">
                        {`Tracks: ${group.affectedTrackIds.join(', ') || 'none'}`}
                    </span>
                    <span className="text-muted-foreground">
                        {`${group.estimatedAudioImpact.level}: ${group.estimatedAudioImpact.summary}`}
                    </span>
                    <span className="text-muted-foreground">{`Warnings: ${group.warnings.join('; ') || 'none'}`}</span>
                </li>
            ))}
        </ul>
    );
}

function renderDestructiveChanges(changes: readonly ApprovalDestructiveChange[]): ReactElement {
    if (changes.length === 0) {
        return <p className="text-muted-foreground">Destructive changes: none</p>;
    }
    return (
        <ul aria-label="Destructive changes" className="flex flex-col gap-0.5 text-destructive">
            {changes.map((change) => (
                <li key={`${change.classification}-${change.consequence}`}>
                    {`${change.classification}: ${change.consequence} (recovery: ${change.recovery})`}
                </li>
            ))}
        </ul>
    );
}

function renderLedger(view: AgentApprovalView): ReactElement {
    return (
        <>
            <p className="text-muted-foreground">{`Consequences: ${formatEntries(view.consequences)}`}</p>
            <p className="text-muted-foreground">{`Budgets: ${formatEntries(view.budgets)}`}</p>
            <p className="text-muted-foreground">{`Cost: ${formatCost(view.cost)}`}</p>
            <p className="text-muted-foreground">{`Data disclosure: ${formatDisclosure(view.dataDisclosure)}`}</p>
            <p className="text-muted-foreground">{`Actor: ${view.actor?.localActorId ?? 'none'}`}</p>
            <p className="text-muted-foreground">{`Valid while project revision ${view.expiry.revision}`}</p>
            <p className="text-muted-foreground">{`Created: ${new Date(view.createdAt).toISOString()}`}</p>
            <p className="text-muted-foreground">{`Resolved: ${formatInstant(view.resolvedAt)}`}</p>
        </>
    );
}

function renderFreshness(freshness: AgentApprovalView['freshness']): ReactElement {
    return (
        <Row gap={1} align="center">
            <span data-freshness={freshness.status} className="text-muted-foreground">
                {freshness.status}
            </span>
            {freshness.reason === undefined ? null : <span className="text-muted-foreground">{freshness.reason}</span>}
        </Row>
    );
}

const ApprovalCard = ({
    view,
    excludedGroupIds,
    onToggleGroup,
    onConfirm,
    onCancel,
    onRePreview,
}: ApprovalCardProps): ReactElement => {
    const includedGroupIds = view.intentGroups
        .filter((group) => !excludedGroupIds.includes(group.id))
        .map((group) => group.id);
    // A partially accepted proposal may still match the project, so a subset re-preview
    // stands on its own rather than on the staleness the whole-proposal route needs.
    const isSubset = view.partialAcceptance.available && includedGroupIds.length < view.intentGroups.length;

    return (
        <Stack gap={1} className="rounded border border-border/60 bg-surface-raised/80 p-2 text-xs">
            <p className="text-foreground">{view.prompt}</p>
            <ul aria-label="Proposed actions" className="list-inside list-disc text-foreground">
                {view.actionLabels.map((label) => (
                    <li key={label}>{label}</li>
                ))}
            </ul>
            {renderScope(view.scope)}
            {renderRisk(view.risk)}
            {renderIntentGroups(view, excludedGroupIds, onToggleGroup)}
            {view.partialAcceptance.reason === null ? null : (
                <p className="text-muted-foreground">{view.partialAcceptance.reason}</p>
            )}
            {renderDestructiveChanges(view.destructiveChanges)}
            {renderLedger(view)}
            {renderFreshness(view.freshness)}
            <p className="text-foreground" data-state={view.status}>
                {`Status: ${view.status}`}
            </p>
            {view.error === null ? null : <p className="text-destructive">{view.error}</p>}
            {view.status === 'proposed' ? (
                <>
                    {view.rePreview.available || view.rePreview.reason === null ? null : (
                        <p className="text-muted-foreground">{view.rePreview.reason}</p>
                    )}
                    <Row gap={1}>
                        <Button
                            type="button"
                            size="xs"
                            variant="secondary"
                            aria-label="Confirm agent actions"
                            className="motion-reduce:transition-none"
                            onClick={() => onConfirm(view.confirmationId)}
                        >
                            Confirm
                        </Button>
                        <Button
                            type="button"
                            size="xs"
                            variant="ghost"
                            aria-label="Cancel agent actions"
                            className="motion-reduce:transition-none"
                            onClick={() => onCancel(view.confirmationId)}
                        >
                            Cancel
                        </Button>
                        <Button
                            type="button"
                            size="xs"
                            variant="ghost"
                            aria-label={isSubset ? 'Re-preview selected agent actions' : 'Re-preview agent actions'}
                            className="motion-reduce:transition-none"
                            disabled={!view.rePreview.available && !isSubset}
                            onClick={() => onRePreview(view.confirmationId, isSubset ? includedGroupIds : undefined)}
                        >
                            {isSubset ? 'Re-preview selected' : 'Re-preview'}
                        </Button>
                    </Row>
                </>
            ) : null}
        </Stack>
    );
};

export const AgentApprovalSection = ({
    approvals,
    onConfirm,
    onCancel,
    onRePreview,
}: AgentApprovalSectionProps): ReactElement => {
    const [excludedByConfirmation, setExcludedByConfirmation] = useState<Readonly<Record<string, readonly string[]>>>(
        {}
    );

    const toggleGroup = (view: AgentApprovalView, groupId: string, included: boolean): void => {
        setExcludedByConfirmation((current) => ({
            ...current,
            [view.confirmationId]: nextExclusion(
                view.intentGroups,
                current[view.confirmationId] ?? [],
                groupId,
                included
            ),
        }));
    };

    return (
        <Stack as="section" gap={2} aria-label="Approvals">
            <h4 className="text-xs font-semibold text-foreground">Approvals</h4>
            {approvals.length === 0 ? <p className="text-xs text-muted-foreground">No approvals requested</p> : null}
            {approvals.map((view) => (
                <ApprovalCard
                    key={view.confirmationId}
                    view={view}
                    excludedGroupIds={excludedByConfirmation[view.confirmationId] ?? []}
                    onToggleGroup={(groupId, included) => toggleGroup(view, groupId, included)}
                    onConfirm={onConfirm}
                    onCancel={onCancel}
                    onRePreview={onRePreview}
                />
            ))}
        </Stack>
    );
};
