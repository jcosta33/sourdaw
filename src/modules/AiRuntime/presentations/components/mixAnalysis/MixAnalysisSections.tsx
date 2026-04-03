import { type ReactElement } from 'react';
import { DawMeterBar } from '#/components/daw/DawMeterBar';
import { DawReadoutRow } from '#/components/daw/DawReadoutRow';
import { DawStatusDot } from '#/components/daw/DawStatusDot';
import { AlertCircle, AlertTriangle, Info, Volume2 } from 'lucide-react';
import { type MixAnalysis, type MixIssue } from '#/modules/AiRuntime/models/MixAnalysis';

// ── Shared helpers ──────────────────────────────────────────────────────

export const levelColor = (db: number): string => {
    if (db > -0.5) {
        return 'bg-[var(--color-state-danger)]';
    }
    if (db > -3) {
        return 'bg-[var(--color-state-warning)]';
    }
    if (db > -12) {
        return 'bg-[var(--color-state-success)]';
    }
    return 'bg-[var(--color-state-success)]';
};

export const levelTextColor = (db: number): string => {
    if (db > -0.5) {
        return 'text-[var(--color-state-danger)]';
    }
    if (db > -3) {
        return 'text-[var(--color-state-warning)]';
    }
    return 'text-[var(--color-state-success)]';
};

export const severityIcon = (severity: MixIssue['severity']): ReactElement => {
    switch (severity) {
        case 'critical':
            return <AlertCircle className="size-3 shrink-0 text-[var(--color-state-danger)]" />;
        case 'warning':
            return <AlertTriangle className="size-3 shrink-0 text-[var(--color-state-warning)]" />;
        case 'info':
            return <Info className="size-3 shrink-0 text-[var(--color-accent-cyan)]" />;
    }
};

export const BAND_LABELS: Array<{ key: keyof MixAnalysis['frequencyBalance']; label: string; range: string }> = [
    { key: 'sub', label: 'Sub', range: '20–60 Hz' },
    { key: 'bass', label: 'Bass', range: '60–250 Hz' },
    { key: 'lowMid', label: 'Low-Mid', range: '250–500 Hz' },
    { key: 'mid', label: 'Mid', range: '500–2k Hz' },
    { key: 'highMid', label: 'Hi-Mid', range: '2k–6k Hz' },
    { key: 'high', label: 'High', range: '6k–20k Hz' },
];

// ── FrequencyBar ────────────────────────────────────────────────────────

type FrequencyBarProps = { label: string; range: string; db: number };

export const FrequencyBar = ({ label, range, db }: FrequencyBarProps): ReactElement => {
    const normalizedWidth = Math.max(0, Math.min(100, ((db + 100) / 100) * 100));
    return (
        <div className="space-y-0.5">
            <DawReadoutRow label={<span title={range}>{label}</span>} value={`${db.toFixed(1)} dB`} />
            <DawMeterBar
                size="sm"
                className="w-full bg-surface-overlay shadow-none"
                fillClassName={`h-full rounded-full transition-all ${levelColor(db)}`}
                value={normalizedWidth}
            />
        </div>
    );
};

// ── OverallLevel ────────────────────────────────────────────────────────

type OverallLevelProps = { level: MixAnalysis['overallLevel'] };

export const OverallLevel = ({ level }: OverallLevelProps): ReactElement => (
    <section>
        <h3 className="mb-2 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Master Level</h3>
        <div className="flex items-center gap-3">
            <DawStatusDot className={`size-2.5 ${levelColor(level.peakDb)}`} />
            <div className="flex-1 space-y-0.5">
                <DawReadoutRow
                    label="Peak"
                    value={`${level.peakDb.toFixed(1)} dB`}
                    valueClassName={`text-xs font-medium ${levelTextColor(level.peakDb)}`}
                />
                <DawReadoutRow label="RMS" value={`${level.rmsDb.toFixed(1)} dB`} valueClassName="text-xs" />
            </div>
        </div>
    </section>
);

// ── FrequencyBalance ────────────────────────────────────────────────────

type FrequencyBalanceProps = { bands: MixAnalysis['frequencyBalance'] };

export const FrequencyBalance = ({ bands }: FrequencyBalanceProps): ReactElement => (
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

// ── TrackLevelsList ─────────────────────────────────────────────────────

type TrackLevelsListProps = { trackLevels: MixAnalysis['trackLevels'] };

export const TrackLevelsList = ({ trackLevels }: TrackLevelsListProps): ReactElement => (
    <section>
        <h3 className="mb-2 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
            Track Levels ({trackLevels.length})
        </h3>
        {trackLevels.length > 0 ? (
            <div className="space-y-1">
                {trackLevels.map((tl) => (
                    <div
                        key={tl.trackId}
                        className={`flex items-center justify-between rounded bg-surface-overlay px-2 py-1 ${tl.isMuted ? 'opacity-40' : ''}`}
                    >
                        <div className="flex items-center gap-1.5 min-w-0">
                            <Volume2 className="size-3 shrink-0 text-muted-foreground" />
                            <span className="text-xs text-foreground truncate">{tl.trackName}</span>
                            {tl.isMuted ? <span className="text-[9px] text-muted-foreground">M</span> : null}
                            {tl.isSoloed ? <span className="text-[9px] text-[var(--color-state-warning)]">S</span> : null}
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                            <span
                                className={`text-[10px] font-mono ${tl.isClipping ? 'text-[var(--color-state-danger)] font-bold' : 'text-muted-foreground'}`}
                            >
                                {tl.peakDb.toFixed(1)} dB
                            </span>
                            <DawStatusDot className={levelColor(tl.peakDb)} />
                        </div>
                    </div>
                ))}
            </div>
        ) : (
            <p className="text-[10px] text-muted-foreground">No tracks to analyze.</p>
        )}
    </section>
);

// ── IssuesList ──────────────────────────────────────────────────────────

type IssuesListProps = { issues: MixIssue[] };

export const IssuesList = ({ issues }: IssuesListProps): ReactElement | null => {
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

// ── SuggestionsList ─────────────────────────────────────────────────────

type SuggestionsListProps = { suggestions: string[] };

export const SuggestionsList = ({ suggestions }: SuggestionsListProps): ReactElement | null => {
    if (suggestions.length === 0) {
        return null;
    }
    return (
        <section>
            <h3 className="mb-2 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Suggestions</h3>
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
