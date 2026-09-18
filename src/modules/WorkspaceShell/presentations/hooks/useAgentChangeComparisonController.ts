import { useEffect, useRef } from 'react';

import { useStore } from '#/infra/store/useStore';
import { agentChangeComparisonStore } from '#/modules/AiRuntime/stores';
import { agentChangeComparison, getAgentChangeComparisonView } from '#/modules/AiRuntime/useCases';

type AgentChangeComparisonState = NonNullable<typeof agentChangeComparisonStore.value>;

/** Stable identity: `useSyncExternalStore` re-renders forever on a fresh default per read. */
const EMPTY_COMPARISON_STATE: AgentChangeComparisonState = { active: null, lastEnded: null };

/** What the Compare control disables against, keyed by group id. */
type ComparisonAvailability = { available: true } | { available: false; reason: string };

/** `agentChangeComparison.availability`'s refusal reasons, restated in musician-facing text. */
const COMPARISON_REFUSAL_TEXT: Record<string, string> = {
    'later-edits': 'Newer edits exist',
    'runtime-group': 'Runtime action',
    reverted: 'Reverted',
    'another-comparison-active': 'Another comparison is running',
};

/**
 * The active group's own availability is `{ available: true }` without a call:
 * `availability` reports `later-edits` for the group standing in an active
 * comparison, because reverting it out from under a running toggle would be
 * exactly the edit it is warning about.
 */
function resolveComparisonAvailability(groupId: string, activeGroupId: string | null): ComparisonAvailability {
    if (groupId === activeGroupId) {
        return { available: true };
    }
    const result = agentChangeComparison.availability({ groupId });
    if (result.available) {
        return { available: true };
    }
    return { available: false, reason: COMPARISON_REFUSAL_TEXT[result.reason] ?? result.reason };
}

function computeComparisonAvailability(
    historyGroups: readonly { groupId: string }[],
    activeGroupId: string | null
): Readonly<Record<string, ComparisonAvailability>> {
    return Object.fromEntries(
        historyGroups.map((group) => [group.groupId, resolveComparisonAvailability(group.groupId, activeGroupId)])
    );
}

function findComparisonPrompt(
    historyGroups: readonly { groupId: string; prompt: string }[],
    activeGroupId: string | null
): string {
    if (activeGroupId === null) {
        return '';
    }
    return historyGroups.find((group) => group.groupId === activeGroupId)?.prompt ?? '';
}

/**
 * Everything the agent-change-comparison surface needs beyond the shared
 * heading/list focus request `AgentWorkspace` already tracks: the store
 * subscription, the derived view, per-group availability, the two DOM refs a
 * comparison focuses, and the mutations the Compare/toggle/End controls call.
 *
 * `requestComparisonFocus` stays owned by the caller because it shares one
 * state machine with the run list's own heading/list focus requests.
 */
export function useAgentChangeComparisonController(
    historyGroups: readonly { groupId: string; prompt: string }[],
    requestComparisonFocus: () => void
) {
    // The comparison view and per-group availability are read through use
    // cases on every render, not from values the compiler can see change —
    // same reason `AgentWorkspace` itself carries this directive.
    'use no memo';

    const comparisonToggleRef = useRef<HTMLButtonElement>(null);
    const historySectionRef = useRef<HTMLElement>(null);

    useStore(agentChangeComparisonStore, EMPTY_COMPARISON_STATE);
    const comparison = getAgentChangeComparisonView();
    const comparisonAvailability = computeComparisonAvailability(historyGroups, comparison.active?.groupId ?? null);
    const comparisonPrompt = findComparisonPrompt(historyGroups, comparison.active?.groupId ?? null);

    // Leaving the workspace mid-comparison must not leave the master trim and
    // sampler running behind a surface no longer showing either side.
    useEffect(() => {
        return () => {
            if (!agentChangeComparisonStore.value?.active) {
                return;
            }
            void agentChangeComparison.end();
        };
    }, []);

    const focusCompareButton = (groupId: string): void => {
        const buttons = historySectionRef.current?.querySelectorAll<HTMLButtonElement>('button[data-compare-group-id]');
        const button = Array.from(buttons ?? []).find((candidate) => candidate.dataset.compareGroupId === groupId);
        button?.focus();
    };

    const handleCompare = (groupId: string): void => {
        void agentChangeComparison.start({ groupId });
        requestComparisonFocus();
    };

    const handleEndComparison = (): void => {
        const endedGroupId = comparison.active?.groupId ?? null;
        void agentChangeComparison.end().then(() => {
            if (endedGroupId === null) {
                return;
            }
            focusCompareButton(endedGroupId);
        });
    };

    const handleToggleSide = (): void => {
        void agentChangeComparison.toggle();
    };

    return {
        comparison,
        comparisonAvailability,
        comparisonPrompt,
        comparisonToggleRef,
        historySectionRef,
        handleCompare,
        handleEndComparison,
        handleToggleSide,
    };
}
