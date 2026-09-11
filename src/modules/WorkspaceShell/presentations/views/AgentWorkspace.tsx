import { type ReactElement, useEffect, useRef, useState } from 'react';

import { DawHeaderBand } from '#/components/daw/DawHeaderBand';
import { Row, Stack } from '#/components/layout';
import { useStore } from '#/infra/store/useStore';
import { AgentRunDecisionPanel } from '#/modules/AiRuntime/presentations/views';
import { agentRunStore, aiActionHistoryStore, pendingActionConfirmationStore } from '#/modules/AiRuntime/stores';
import {
    agentRunCancellation,
    agentRunControls,
    cancelPendingChatActions,
    confirmPendingChatActions,
    getProviderRouteView,
    revertAiActionGroup,
} from '#/modules/AiRuntime/useCases';

import { AgentApprovalSection } from '../components/agentWorkspace/AgentApprovalSection';
import { AgentPlanSection } from '../components/agentWorkspace/AgentPlanSection';
import { AgentProgressSection } from '../components/agentWorkspace/AgentProgressSection';
import { AgentRouteSection } from '../components/agentWorkspace/AgentRouteSection';
import { AgentRunControlsSection } from '../components/agentWorkspace/AgentRunControlsSection';
import { AgentRunHistorySection } from '../components/agentWorkspace/AgentRunHistorySection';
import { AgentRunList } from '../components/agentWorkspace/AgentRunList';
import { AgentRunSummary } from '../components/agentWorkspace/AgentRunSummary';

type AgentRunState = NonNullable<typeof agentRunStore.value>;
type AiActionHistoryState = NonNullable<typeof aiActionHistoryStore.value>;
type PendingActionConfirmationState = NonNullable<typeof pendingActionConfirmationStore.value>;

/** Stable identities: `useSyncExternalStore` re-renders forever on a fresh default per read. */
const EMPTY_AGENT_RUN_STATE: AgentRunState = { schemaVersion: 1, runs: [] };
const EMPTY_HISTORY_STATE: AiActionHistoryState = { groups: [], panelOpen: false };
const EMPTY_CONFIRMATION_STATE: PendingActionConfirmationState = { confirmations: [] };

/**
 * Bottom-dock surface for agent runs. It reads AiRuntime's run, approval and
 * provider-route projections, passes them to leaf sections, and owns no state
 * beyond which run is selected.
 */
export const AgentWorkspace = (): ReactElement => {
    // The run list and route are read through use cases on every render, not
    // from values the compiler can see change.
    'use no memo';

    const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
    const [focusRequest, setFocusRequest] = useState<'heading' | 'list' | null>(null);
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
    const confirmations = confirmationState.confirmations
        .filter((confirmation) => confirmation.runId === effectiveRunId)
        .toSorted((left, right) => right.createdAt - left.createdAt);
    const historyGroups = historyState.groups.toSorted((left, right) => right.timestamp - left.timestamp);

    useEffect(() => {
        if (!selectionRemoved) {
            return;
        }
        // Clearing the stale selection is what stops this effect from re-firing:
        // once selectedRunId is null, selectionRemoved is false on the next render.
        setSelectedRunId(null);
        setFocusRequest('list');
    }, [selectionRemoved]);

    useEffect(() => {
        if (focusRequest === null) {
            return;
        }
        if (focusRequest === 'heading') {
            summaryHeadingRef.current?.focus();
        } else {
            runListRef.current?.focus();
        }
        setFocusRequest(null);
    }, [focusRequest]);

    const revertHistoryGroup = (group: AiActionHistoryState['groups'][number] | undefined): void => {
        if (group === undefined) {
            return;
        }
        void revertAiActionGroup(group);
    };

    return (
        <Stack className="h-full w-full overflow-hidden" data-testid="agent-workspace">
            <DawHeaderBand title="Agent" />
            <Row align="stretch" grow className="min-h-0 overflow-hidden">
                <Stack className="w-64 min-h-0 shrink-0 overflow-hidden border-r border-border/50">
                    <AgentRunList
                        ref={runListRef}
                        runs={runs}
                        selectedRunId={effectiveRunId}
                        onSelect={setSelectedRunId}
                        onActivate={(runId) => {
                            setSelectedRunId(runId);
                            setFocusRequest('heading');
                        }}
                    />
                </Stack>
                <Stack gap={3} grow className="min-h-0 min-w-0 overflow-y-auto p-3">
                    <AgentRunSummary run={selectedRun} headingRef={summaryHeadingRef} />
                    <AgentPlanSection plan={selectedRun?.plan ?? null} />
                    <AgentProgressSection progress={projection} />
                    <AgentRunDecisionPanel />
                    <AgentApprovalSection
                        confirmations={confirmations}
                        onConfirm={(confirmationId) => {
                            void confirmPendingChatActions({ confirmationId });
                        }}
                        onCancel={(confirmationId) => {
                            void cancelPendingChatActions({ confirmationId });
                        }}
                    />
                    <AgentRouteSection route={route} />
                    <AgentRunControlsSection
                        controls={projection}
                        revertableGroupIds={historyGroups.map((group) => group.groupId)}
                        onCancelRun={(runId) => {
                            void agentRunCancellation.cancel({ runId, reason: 'user-requested' });
                        }}
                        onRevertGroup={(groupId) => {
                            revertHistoryGroup(historyGroups.find((group) => group.groupId === groupId));
                        }}
                    />
                    <AgentRunHistorySection
                        groups={historyGroups}
                        onRevert={(groupId) => {
                            revertHistoryGroup(historyGroups.find((group) => group.id === groupId));
                        }}
                    />
                </Stack>
            </Row>
        </Stack>
    );
};
