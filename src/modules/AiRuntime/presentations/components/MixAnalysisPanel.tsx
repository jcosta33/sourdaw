import { type ReactElement, useSyncExternalStore } from "react";
import { Button } from "#/components/ui/button";
import { ScrollArea } from "#/components/ui/scroll-area";
import { Separator } from "#/components/ui/separator";
import {
    Activity,
    AlertTriangle,
    AlertCircle,
    Info,
    RefreshCw,
    Wrench,
    X,
    Volume2,
} from "lucide-react";
import { mixAnalysisStore, toggleMixAnalysisPanel } from "#/modules/AiRuntime/stores/mixAnalysisStore";
import { executeAppAction } from "#/modules/Command/useCases/executeAppAction";
import type { MixAnalysisResult, MixIssue } from "#/modules/AiRuntime/useCases/analyzeMix";

type MixAnalysisStoreState = {
    result: MixAnalysisResult | null;
    isAnalyzing: boolean;
    panelOpen: boolean;
};

const defaultState: MixAnalysisStoreState = { result: null, isAnalyzing: false, panelOpen: false };

const BAND_LABELS: Array<{ key: keyof MixAnalysisResult["frequencyBalance"]; label: string; range: string }> = [
    { key: "sub", label: "Sub", range: "20–60 Hz" },
    { key: "bass", label: "Bass", range: "60–250 Hz" },
    { key: "lowMid", label: "Low-Mid", range: "250–500 Hz" },
    { key: "mid", label: "Mid", range: "500–2k Hz" },
    { key: "highMid", label: "Hi-Mid", range: "2k–6k Hz" },
    { key: "high", label: "High", range: "6k–20k Hz" },
];

const levelColor = (db: number): string => {
    if (db > -0.5) {
        return "bg-red-500";
    }
    if (db > -3) {
        return "bg-amber-500";
    }
    if (db > -12) {
        return "bg-emerald-500";
    }
    return "bg-emerald-700";
};

const levelTextColor = (db: number): string => {
    if (db > -0.5) {
        return "text-red-400";
    }
    if (db > -3) {
        return "text-amber-400";
    }
    return "text-emerald-400";
};

const severityIcon = (severity: MixIssue["severity"]): ReactElement => {
    switch (severity) {
        case "critical":
            return <AlertCircle className="size-3 shrink-0 text-red-400" />;
        case "warning":
            return <AlertTriangle className="size-3 shrink-0 text-amber-400" />;
        case "info":
            return <Info className="size-3 shrink-0 text-blue-400" />;
    }
};

const FrequencyBar = ({ label, range, db }: { label: string; range: string; db: number }): ReactElement => {
    const normalizedWidth = Math.max(0, Math.min(100, ((db + 100) / 100) * 100));

    return (
        <div className="space-y-0.5">
            <div className="flex items-center justify-between">
                <span className="text-[10px] text-muted-foreground" title={range}>{label}</span>
                <span className="text-[10px] font-mono text-muted-foreground">{db.toFixed(1)} dB</span>
            </div>
            <div className="h-1.5 w-full rounded-full bg-surface-overlay">
                <div
                    className={`h-full rounded-full transition-all ${levelColor(db)}`}
                    style={{ width: `${String(normalizedWidth)}%` }}
                />
            </div>
        </div>
    );
};

const OverallLevel = ({ level }: { level: MixAnalysisResult["overallLevel"] }): ReactElement => (
    <section>
        <h3 className="mb-2 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
            Master Level
        </h3>
        <div className="flex items-center gap-3">
            <div className={`size-2.5 rounded-full ${levelColor(level.peakDb)}`} />
            <div className="flex-1 space-y-0.5">
                <div className="flex items-center justify-between">
                    <span className="text-[10px] text-muted-foreground">Peak</span>
                    <span className={`text-xs font-mono font-medium ${levelTextColor(level.peakDb)}`}>
                        {level.peakDb.toFixed(1)} dB
                    </span>
                </div>
                <div className="flex items-center justify-between">
                    <span className="text-[10px] text-muted-foreground">RMS</span>
                    <span className="text-xs font-mono text-muted-foreground">
                        {level.rmsDb.toFixed(1)} dB
                    </span>
                </div>
            </div>
        </div>
    </section>
);

const FrequencyBalance = ({ bands }: { bands: MixAnalysisResult["frequencyBalance"] }): ReactElement => (
    <section>
        <h3 className="mb-2 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
            Frequency Balance
        </h3>
        <div className="space-y-1.5">
            {BAND_LABELS.map(({ key, label, range }) => (
                <FrequencyBar key={key} label={label} range={range} db={bands[key]} />
            ))}
        </div>
    </section>
);

const TrackLevelsList = ({ trackLevels }: { trackLevels: MixAnalysisResult["trackLevels"] }): ReactElement => (
    <section>
        <h3 className="mb-2 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
            Track Levels ({trackLevels.length})
        </h3>
        {trackLevels.length > 0 ? (
            <div className="space-y-1">
                {trackLevels.map((tl) => (
                    <div
                        key={tl.trackId}
                        className={`flex items-center justify-between rounded bg-surface-overlay px-2 py-1 ${tl.isMuted ? "opacity-40" : ""}`}
                    >
                        <div className="flex items-center gap-1.5 min-w-0">
                            <Volume2 className="size-3 shrink-0 text-muted-foreground" />
                            <span className="text-xs text-foreground truncate">{tl.trackName}</span>
                            {tl.isMuted && <span className="text-[9px] text-muted-foreground">M</span>}
                            {tl.isSoloed && <span className="text-[9px] text-amber-400">S</span>}
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                            <span className={`text-[10px] font-mono ${tl.isClipping ? "text-red-400 font-bold" : "text-muted-foreground"}`}>
                                {tl.peakDb.toFixed(1)} dB
                            </span>
                            <div className={`size-1.5 rounded-full ${levelColor(tl.peakDb)}`} />
                        </div>
                    </div>
                ))}
            </div>
        ) : (
            <p className="text-[10px] text-muted-foreground">No tracks to analyze.</p>
        )}
    </section>
);

const IssuesList = ({ issues }: { issues: MixIssue[] }): ReactElement | null => {
    if (issues.length === 0) {
        return null;
    }

    return (
        <section>
            <h3 className="mb-2 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                Issues ({issues.length})
            </h3>
            <div className="space-y-1">
                {issues.map((issue, i) => (
                    <div key={i} className="flex items-start gap-1.5 rounded bg-surface-overlay px-2 py-1.5">
                        {severityIcon(issue.severity)}
                        <span className="text-[10px] text-foreground leading-tight">{issue.message}</span>
                    </div>
                ))}
            </div>
        </section>
    );
};

const SuggestionsList = ({ suggestions }: { suggestions: string[] }): ReactElement | null => {
    if (suggestions.length === 0) {
        return null;
    }

    return (
        <section>
            <h3 className="mb-2 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                Suggestions
            </h3>
            <ul className="space-y-1">
                {suggestions.map((s, i) => (
                    <li key={i} className="flex items-start gap-1.5 text-[10px] text-muted-foreground leading-tight">
                        <span className="shrink-0 mt-0.5">•</span>
                        <span>{s}</span>
                    </li>
                ))}
            </ul>
        </section>
    );
};

export const MixAnalysisPanel = (): ReactElement | null => {
    const state = useSyncExternalStore(
        (cb) => mixAnalysisStore.subscribe(cb),
        () => mixAnalysisStore.value ?? defaultState,
    );

    if (!state.panelOpen) {
        return null;
    }

    const handleRefresh = () => {
        void executeAppAction({ type: "analyzeMix" });
    };

    const handleAutoFix = () => {
        void executeAppAction({ type: "autoFixMix" });
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
                    <RefreshCw className={`size-3 ${state.isAnalyzing ? "animate-spin" : ""}`} />
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
                        {state.result.issues.length > 0 && <Separator />}
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
                                <RefreshCw className={`size-3 ${state.isAnalyzing ? "animate-spin" : ""}`} />
                                Refresh
                            </Button>
                            <Button
                                variant="default"
                                size="xs"
                                className="flex-1"
                                onClick={handleAutoFix}
                                disabled={state.isAnalyzing || state.result.issues.filter((i) => i.severity !== "info").length === 0}
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
                            {state.isAnalyzing ? "Analyzing mix…" : "Click refresh to analyze the current mix."}
                        </p>
                        {!state.isAnalyzing && (
                            <Button variant="outline" size="xs" onClick={handleRefresh}>
                                <RefreshCw className="size-3" />
                                Analyze Mix
                            </Button>
                        )}
                    </div>
                )}
            </ScrollArea>
        </div>
    );
};
