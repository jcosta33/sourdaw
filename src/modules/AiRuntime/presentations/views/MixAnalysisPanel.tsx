import { type ReactElement } from 'react';
import { useStore } from '#/infra/store/useStore';
import { DawEmptyState } from '#/components/daw/DawEmptyState';
import { DawHeaderBand } from '#/components/daw/DawHeaderBand';
import { DawUtilitySection } from '#/components/daw/DawUtilitySection';
import { DawUtilityPanel } from '#/components/daw/DawUtilityPanel';
import { Button } from '#/components/ui/button';
import { ScrollArea } from '#/components/ui/scroll-area';
import { Activity, RefreshCw, Wrench, X } from 'lucide-react';
import { mixAnalysisStore, toggleMixAnalysisPanel } from '#/modules/AiRuntime/stores/mixAnalysisStore';
import { runAppAction } from '#/modules/AiRuntime/useCases/aiPanelActions';
import { type MixAnalysis } from '#/modules/AiRuntime/models/MixAnalysis';
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

    if (!state.panelOpen) {
        return null;
    }

    const handleRefresh = () => {
        void runAppAction({ type: 'analyzeMix' });
    };

    const handleAutoFix = () => {
        void runAppAction({ type: 'autoFixMix' });
    };

    return (
        <DawUtilityPanel className="fixed right-4 bottom-16 z-50 flex max-h-[70vh] w-80 flex-col animate-in slide-in-from-right-5">
            <DawHeaderBand
                className="rounded-t-lg px-3 py-2"
                startSlot={<Activity className="size-3.5 text-[var(--color-state-success)]" />}
                title="Mix Analysis"
                titleClassName="text-xs font-medium normal-case tracking-normal text-foreground"
                actions={
                    <div className="flex items-center gap-1">
                        <Button
                            variant="ghost"
                            size="icon-xs"
                            onClick={handleRefresh}
                            disabled={state.isAnalyzing}
                            title="Refresh analysis"
                            aria-label="Refresh mix analysis"
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
                    </div>
                }
            />

            <ScrollArea className="flex-1 max-h-[60vh]">
                {state.result ? (
                    <div className="space-y-3 p-3">
                        <OverallLevel level={state.result.overallLevel} />
                        <FrequencyBalance bands={state.result.frequencyBalance} />
                        <TrackLevelsList trackLevels={state.result.trackLevels} />
                        <IssuesList issues={state.result.issues} />
                        <SuggestionsList suggestions={state.result.suggestions} />
                        <DawUtilitySection
                            title="Actions"
                            detail={`Analyzed at ${new Date(state.result.timestamp).toLocaleTimeString()}`}
                        >
                            <div className="flex gap-2">
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
                                        state.result.issues.filter((i) => i.severity !== 'info').length === 0
                                    }
                                >
                                    <Wrench className="size-3" />
                                    Auto-Fix
                                </Button>
                            </div>
                        </DawUtilitySection>
                    </div>
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
