import { useRef, useState } from 'react';

import { useStore } from '#/infra/store/useStore';
import { agentRunStore, aiActionHistoryStore, pendingActionConfirmationStore } from '#/modules/AiRuntime/stores';
import {
    agentRunControls,
    getAgentApprovalView,
    getProviderRouteView,
    revertAiActionGroup,
} from '#/modules/AiRuntime/useCases';

type AgentRunState = NonNullable<typeof agentRunStore.value>;
type AiActionHistoryState = NonNullable<typeof aiActionHistoryStore.value>;
type PendingActionConfirmationState = NonNullable<typeof pendingActionConfirmationStore.value>;

/** Stable identities: `useSyncExternalStore` re-renders forever on a fresh default per read. */
const EMPTY_AGENT_RUN_STATE: AgentRunState = { schemaVersion: 1, runs: [] };
const EMPTY_HISTORY_STATE: AiActionHistoryState = { groups: [], panelOpen: false };
const EMPTY_CONFIRMATION_STATE: PendingActionConfirmationState = { confirmations: [] };

export type AgentWorkspaceFocusRequest = 'heading' | 'list' | 'comparison' | null;

/**
 * Which run is selected, the projections that follow from it, and the history
 * groups every revert and comparison control reads. Owns only the selection's
 * own focus-recovery effect — a run disappearing sends focus back to the list
 * — because the shared heading/list/comparison dispatch effect also depends on
 * the comparison controller's own ref and needs to live where both meet.
 */
export function useAgentWorkspaceRunSelection() {
    // Run list, route and approvals are read through use cases on every
    // render, not from values the compiler can see change — same reason
    // `AgentWorkspace` itself carries this directive.
    'use no memo';

    const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
    const [focusRequest, setFocusRequest] = useState<AgentWorkspaceFocusRequest>(null);
    const runListRef = useRef<HTMLDivElement>(null);
    const summaryHeadingRef = useRef<HTMLHeadingElement>(null);

    const agentRunState = useStore(agentRunStore, EMPTY_AGENT_RUN_STATE);
    const historyState = useStore(aiActionHistoryStore, EMPTY_HISTORY_STATE);
    const confirmationState = useStore(pendingActionConfirmationStore, EMPTY_CONFIRMATION_STATE);

    const runs = agentRunControls.list();
    const selectionSurvives = runs.some((run) => run.runId === selectedRunId);
    const effectiveRunId = selectionSurvives ? selectedRunId : (runs[0]?.runId ?? null);
    const selectionRemoved = selectedRunId !== null && !selectionSurvives;
    const selectedRun = agentRunState.runs.find((run) => run.runId === effectiveRunId) ?? null;

    const projection = effectiveRunId === null ? null : agentRunControls.get(effectiveRunId);
    const route = effectiveRunId === null ? null : getProviderRouteView({ runId: effectiveRunId });
    const approvals = confirmationState.confirmations
        .filter((confirmation) => confirmation.runId === effectiveRunId)
        .toSorted((left, right) => right.createdAt - left.createdAt)
        .flatMap((confirmation) => getAgentApprovalView({ confirmationId: confirmation.id }) ?? []);
    const historyGroups = historyState.groups.toSorted((left, right) => right.timestamp - left.timestamp);

    // React's recommended "adjust state during render" pattern (same precedent
    // as Bacteria/SpectralBinEditor's signature re-sync), not an effect:
    // clearing the stale selection in the same render that first observes it
    // missing is what stops this branch from re-firing — once selectedRunId is
    // null, selectionRemoved is false on the very next check below.
    if (selectionRemoved) {
        setSelectedRunId(null);
        setFocusRequest('list');
    }

    const revertHistoryGroup = (group: AiActionHistoryState['groups'][number] | undefined): void => {
        if (group === undefined) {
            return;
        }
        void revertAiActionGroup(group);
    };

    return {
        runs,
        effectiveRunId,
        selectedRun,
        projection,
        route,
        approvals,
        historyGroups,
        runListRef,
        summaryHeadingRef,
        setSelectedRunId,
        focusRequest,
        setFocusRequest,
        revertHistoryGroup,
    };
}
