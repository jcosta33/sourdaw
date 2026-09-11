import { type ReactElement } from 'react';

import { DawHeaderBand } from '#/components/daw/DawHeaderBand';
import { Row, Stack } from '#/components/layout';
import { AgentRunDecisionPanel } from '#/modules/AiRuntime/presentations/views';
import {
    agentRunCancellation,
    cancelPendingChatActions,
    confirmPendingChatActions,
    reproposePendingChatActions,
} from '#/modules/AiRuntime/useCases';

import { AgentApprovalSection } from '../components/agentWorkspace/AgentApprovalSection';
import { AgentComparisonSection } from '../components/agentWorkspace/AgentComparisonSection';
import { AgentPlanSection } from '../components/agentWorkspace/AgentPlanSection';
import { AgentProgressSection } from '../components/agentWorkspace/AgentProgressSection';
import { AgentRouteSection } from '../components/agentWorkspace/AgentRouteSection';
import { AgentRunControlsSection } from '../components/agentWorkspace/AgentRunControlsSection';
import { AgentRunHistorySection } from '../components/agentWorkspace/AgentRunHistorySection';
import { AgentRunList } from '../components/agentWorkspace/AgentRunList';
import { AgentRunSummary } from '../components/agentWorkspace/AgentRunSummary';
import { useAgentChangeComparisonController } from '../hooks/useAgentChangeComparisonController';
import { useAgentWorkspaceFocusDispatch } from '../hooks/useAgentWorkspaceFocusDispatch';
import { useAgentWorkspaceRunSelection } from '../hooks/useAgentWorkspaceRunSelection';

/**
 * Bottom-dock surface for agent runs. It reads AiRuntime's run, approval and
 * provider-route projections, passes them to leaf sections, and owns no state
 * beyond which run is selected.
 */
export const AgentWorkspace = (): ReactElement => {
    // The run list and route are read through use cases on every render, not
    // from values the compiler can see change.
    'use no memo';

    const {
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
    } = useAgentWorkspaceRunSelection();
    const {
        comparison,
        comparisonAvailability,
        comparisonPrompt,
        comparisonToggleRef,
        historySectionRef,
        handleCompare,
        handleEndComparison,
        handleToggleSide,
    } = useAgentChangeComparisonController(historyGroups, () => setFocusRequest('comparison'));

    useAgentWorkspaceFocusDispatch(
        focusRequest,
        setFocusRequest,
        { summaryHeadingRef, runListRef, comparisonToggleRef },
        comparison.active !== null
    );

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
                        approvals={approvals}
                        onConfirm={(confirmationId) => {
                            void confirmPendingChatActions({ confirmationId });
                        }}
                        onCancel={(confirmationId) => {
                            void cancelPendingChatActions({ confirmationId });
                        }}
                        onRePreview={(confirmationId, selectedIntentGroupIds) => {
                            void reproposePendingChatActions({ confirmationId, selectedIntentGroupIds });
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
                    <AgentComparisonSection
                        active={comparison.active}
                        lastEnded={comparison.lastEnded}
                        prompt={comparisonPrompt}
                        toggleRef={comparisonToggleRef}
                        onToggleSide={handleToggleSide}
                        onEnd={handleEndComparison}
                    />
                    <AgentRunHistorySection
                        ref={historySectionRef}
                        groups={historyGroups}
                        comparisonAvailability={comparisonAvailability}
                        onRevert={(groupId) => {
                            revertHistoryGroup(historyGroups.find((group) => group.id === groupId));
                        }}
                        onCompare={handleCompare}
                    />
                </Stack>
            </Row>
        </Stack>
    );
};
