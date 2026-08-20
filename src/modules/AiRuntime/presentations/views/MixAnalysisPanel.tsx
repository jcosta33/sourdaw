import { type ReactElement, useState } from 'react';

import { Activity, RefreshCw, Wrench, X } from 'lucide-react';

import { DawEmptyState } from '#/components/daw/DawEmptyState';
import { DawHeaderBand } from '#/components/daw/DawHeaderBand';
import { DawUtilityPanel } from '#/components/daw/DawUtilityPanel';
import { DawUtilitySection } from '#/components/daw/DawUtilitySection';
import { Row, Stack } from '#/components/layout';
import { Button } from '#/components/ui/button';
import { ScrollArea } from '#/components/ui/scroll-area';
import { useStore } from '#/infra/store/useStore';

import { type MixAnalysis } from '../../models/MixAnalysis';
import { mixAnalysisStore, toggleMixAnalysisPanel } from '../../stores/mixAnalysisStore';
import { runAppAction } from '../../useCases/aiPanelActions/runAppAction';
import {
    OverallLevel,
    FrequencyBalance,
    TrackLevelsList,
    IssuesList,
    SuggestionsList,
} from '../components/mixAnalysis/MixAnalysisSections';

type MixAnalysisStoreState = {
    result: MixAnalysis | null;
    isAnalyzing: boolean;
    panelOpen: boolean;
};

const defaultState: MixAnalysisStoreState = { result: null, isAnalyzing: false, panelOpen: false };

export const MixAnalysisPanel = (): ReactElement | null => {
    const state = useStore(mixAnalysisStore, defaultState);
    const [action_error, setActionError] = useState<string | null>(null);

    if (!state.panelOpen) {
        return null;
    }

    const handleRefresh = async () => {
        setActionError(null);
        try {
            await runAppAction({ type: 'analyzeMix' });
        } catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            setActionError(`Mix action failed: ${reason}`);
        }
    };

    const handleAutoFix = async () => {
        setActionError(null);
        try {
            await runAppAction({ type: 'autoFixMix' });
        } catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            setActionError(`Mix action failed: ${reason}`);
        }
    };

    return (
        <DawUtilityPanel className="fixed right-4 bottom-16 z-50 flex max-h-[70vh] w-80 flex-col animate-in slide-in-from-right-5">
            <DawHeaderBand
                className="rounded-t-lg px-3 py-2"
                startSlot={<Activity className="size-3.5 text-[var(--color-state-success)]" />}
                title="Mix Analysis"
                titleClassName="text-xs font-medium normal-case tracking-normal text-foreground"
                actions={
                    <Row gap={1}>
                        <Button
                            variant="ghost"
                            size="icon-xs"
                            onClick={handleRefresh}
                            disabled={state.isAnalyzing}
                            title="Refresh analysis"
                            aria-label="Refresh mix analysis"
                            data-testid="mix-analysis-refresh"
                        >
                            <RefreshCw className={`size-3 ${state.isAnalyzing ? 'animate-spin' : ''}`} />
                        </Button>
                        <Button
                            variant="ghost"
                            size="icon-xs"
                            onClick={toggleMixAnalysisPanel}
                            aria-label="Close mix analysis"
                        >
                            <X className="size-3" />
                        </Button>
                    </Row>
                }
            />
            {action_error ? (
                <div
                    role="alert"
                    className="border-b border-border/50 px-3 py-1.5 text-[10px] text-[var(--color-state-danger)]"
                >
                    {action_error}
                </div>
            ) : null}
            <ScrollArea className="flex-1 max-h-[60vh]">
                {state.result ? (
                    <Stack gap={3} className="p-3">
                        <OverallLevel level={state.result.overallLevel} />
                        <FrequencyBalance bands={state.result.frequencyBalance} />
                        <TrackLevelsList trackLevels={state.result.trackLevels} />
                        <IssuesList issues={state.result.issues} />
                        <SuggestionsList suggestions={state.result.suggestions} />
                        <DawUtilitySection
                            title="Actions"
                            detail={`Analyzed at ${new Date(state.result.timestamp).toLocaleTimeString()}`}
                        >
                            <Row align="stretch" gap={2}>
                                <Button
                                    variant="outline"
                                    size="xs"
                                    className="flex-1"
                                    onClick={handleRefresh}
                                    disabled={state.isAnalyzing}
                                >
                                    <RefreshCw className={`size-3 ${state.isAnalyzing ? 'animate-spin' : ''}`} />
                                    Refresh
                                </Button>
                                <Button
                                    variant="default"
                                    size="xs"
                                    className="flex-1"
                                    onClick={handleAutoFix}
                                    disabled={
                                        state.isAnalyzing ||
                                        state.result.issues.filter((index) => index.severity !== 'info').length === 0
                                    }
                                >
                                    <Wrench className="size-3" />
                                    Auto-Fix
                                </Button>
                            </Row>
                        </DawUtilitySection>
                    </Stack>
                ) : (
                    <div className="p-3">
                        <DawEmptyState
                            compact
                            icon={
                                state.isAnalyzing ? (
                                    <RefreshCw className="size-4 animate-spin" />
                                ) : (
                                    <Activity className="size-4" />
                                )
                            }
                            title={state.isAnalyzing ? 'Analyzing mix...' : 'No mix analysis yet'}
                            description={
                                state.isAnalyzing
                                    ? 'The current project is being inspected now.'
                                    : 'Run analysis to inspect the current mix.'
                            }
                            action={
                                !state.isAnalyzing ? (
                                    <Button variant="outline" size="xs" onClick={handleRefresh}>
                                        <RefreshCw className="size-3" />
                                        Analyze Mix
                                    </Button>
                                ) : undefined
                            }
                        />
                    </div>
                )}
            </ScrollArea>
        </DawUtilityPanel>
    );
};
