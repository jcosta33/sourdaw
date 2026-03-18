import { type ReactElement, useSyncExternalStore } from 'react';
import { Button } from '#/components/ui/button';
import { ScrollArea } from '#/components/ui/scroll-area';
import { Separator } from '#/components/ui/separator';
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
    const state = useSyncExternalStore(
        (cb) => mixAnalysisStore.subscribe(cb),
        () => mixAnalysisStore.value ?? defaultState
    );

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
        <div className="fixed right-4 bottom-16 z-50 w-80 max-h-[70vh] rounded-lg border border-border bg-surface-raised shadow-xl flex flex-col animate-in slide-in-from-right-5">
            <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
                <Activity className="size-3.5 text-emerald-400" />
                <span className="text-xs font-medium text-foreground flex-1">Mix Analysis</span>
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
                <Button variant="ghost" size="icon-xs" onClick={toggleMixAnalysisPanel} aria-label="Close mix analysis">
                    <X className="size-3" />
                </Button>
            </div>

            <ScrollArea className="flex-1 max-h-[60vh]">
                {state.result ? (
                    <div className="space-y-3 p-3">
                        <OverallLevel level={state.result.overallLevel} />
                        <Separator />
                        <FrequencyBalance bands={state.result.frequencyBalance} />
                        <Separator />
                        <TrackLevelsList trackLevels={state.result.trackLevels} />
                        <Separator />
                        <IssuesList issues={state.result.issues} />
                        {state.result.issues.length > 0 ? <Separator /> : null}
                        <SuggestionsList suggestions={state.result.suggestions} />
                        <Separator />
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
                        <p className="text-[9px] text-muted-foreground text-center">
                            Analyzed at {new Date(state.result.timestamp).toLocaleTimeString()}
                        </p>
                    </div>
                ) : (
                    <div className="p-6 text-center space-y-3">
                        <Activity className="size-8 text-muted-foreground/30 mx-auto" />
                        <p className="text-xs text-muted-foreground">
                            {state.isAnalyzing ? 'Analyzing mix…' : 'Click refresh to analyze the current mix.'}
                        </p>
                        {!state.isAnalyzing ? (
                            <Button variant="outline" size="xs" onClick={handleRefresh}>
                                <RefreshCw className="size-3" />
                                Analyze Mix
                            </Button>
                        ) : null}
                    </div>
                )}
            </ScrollArea>
        </div>
    );
};
