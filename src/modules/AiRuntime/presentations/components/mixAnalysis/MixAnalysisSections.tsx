import { type ReactElement } from 'react';

import { AlertCircle, AlertTriangle, Info, Volume2 } from 'lucide-react';

import { DawMicroBadge } from '#/components/daw/DawMicroBadge';
import { DawReadoutRow } from '#/components/daw/DawReadoutRow';
import { DawStatusDot } from '#/components/daw/DawStatusDot';
import { DawUtilityListRow } from '#/components/daw/DawUtilityListRow';
import { DawUtilityMetric } from '#/components/daw/DawUtilityMetric';
import { DawUtilitySection } from '#/components/daw/DawUtilitySection';
import { Row, Stack } from '#/components/layout';

import { type MixAnalysis, type MixIssue } from '../../../models/MixAnalysis';

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
        default:
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
        <DawUtilityMetric
            label={<span title={range}>{label}</span>}
            value={`${db.toFixed(1)} dB`}
            meterValue={normalizedWidth}
            meterFillClassName={levelColor(db)}
        />
    );
};

// ── OverallLevel ────────────────────────────────────────────────────────

type OverallLevelProps = { level: MixAnalysis['overallLevel'] };

export const OverallLevel = ({ level }: OverallLevelProps): ReactElement => (
    <DawUtilitySection title="Master Level" detail="Peak and RMS at the current master output.">
        <DawUtilityMetric
            label="Peak"
            value={`${level.peakDb.toFixed(1)} dB`}
            startSlot={<DawStatusDot className={`mt-0.5 size-2.5 ${levelColor(level.peakDb)}`} />}
            valueClassName={`text-xs font-medium ${levelTextColor(level.peakDb)}`}
        >
            <DawReadoutRow label="RMS" value={`${level.rmsDb.toFixed(1)} dB`} valueClassName="text-xs" />
        </DawUtilityMetric>
    </DawUtilitySection>
);

// ── FrequencyBalance ────────────────────────────────────────────────────

type FrequencyBalanceProps = { bands: MixAnalysis['frequencyBalance'] };

export const FrequencyBalance = ({ bands }: FrequencyBalanceProps): ReactElement => (
    <DawUtilitySection title="Frequency Balance" detail="Broad-spectrum energy by band.">
        <Stack gap={1.5}>
            {BAND_LABELS.map(({ key, label, range }) => (
                <FrequencyBar key={key} label={label} range={range} db={bands[key]} />
            ))}
        </Stack>
    </DawUtilitySection>
);

// ── TrackLevelsList ─────────────────────────────────────────────────────

type TrackLevelsListProps = { trackLevels: MixAnalysis['trackLevels'] };

export const TrackLevelsList = ({ trackLevels }: TrackLevelsListProps): ReactElement => (
    <DawUtilitySection
        title="Track Levels"
        detail={`${trackLevels.length} track${trackLevels.length === 1 ? '' : 's'} in the current scan.`}
    >
        {trackLevels.length > 0 ? (
            <Stack gap={1}>
                {trackLevels.map((tl) => (
                    <DawUtilityListRow
                        key={tl.trackId}
                        dimmed={tl.isMuted}
                        className="rounded bg-surface-overlay/70 px-2"
                        startSlot={<Volume2 className="size-3 text-muted-foreground" />}
                        title={tl.trackName}
                        endSlot={
                            <Row gap={2}>
                                {tl.isMuted ? (
                                    <DawMicroBadge className="px-1" tone="muted">
                                        M
                                    </DawMicroBadge>
                                ) : null}
                                {tl.isSoloed ? (
                                    <DawMicroBadge className="px-1" tone="peach">
                                        S
                                    </DawMicroBadge>
                                ) : null}
                                <span
                                    className={`text-[10px] font-mono ${tl.isClipping ? 'font-bold text-[var(--color-state-danger)]' : 'text-muted-foreground'}`}
                                >
                                    {tl.peakDb.toFixed(1)} dB
                                </span>
                                <DawStatusDot className={levelColor(tl.peakDb)} />
                            </Row>
                        }
                    />
                ))}
            </Stack>
        ) : (
            <p className="text-[10px] text-muted-foreground">No tracks to analyze.</p>
        )}
    </DawUtilitySection>
);

// ── IssuesList ──────────────────────────────────────────────────────────

type IssuesListProps = { issues: MixIssue[] };

export const IssuesList = ({ issues }: IssuesListProps): ReactElement | null => {
    if (issues.length === 0) {
        return null;
    }
    return (
        <DawUtilitySection
            title="Issues"
            detail={`${issues.length} item${issues.length === 1 ? '' : 's'} need attention.`}
        >
            <Stack gap={1}>
                {issues.map((issue, index) => (
                    <Row align="start" gap={1.5} className="rounded bg-surface-overlay px-2 py-1.5" key={index}>
                        {severityIcon(issue.severity)}
                        <span className="text-[10px] text-foreground leading-tight">{issue.message}</span>
                    </Row>
                ))}
            </Stack>
        </DawUtilitySection>
    );
};

// ── SuggestionsList ─────────────────────────────────────────────────────

type SuggestionsListProps = { suggestions: string[] };

export const SuggestionsList = ({ suggestions }: SuggestionsListProps): ReactElement | null => {
    if (suggestions.length === 0) {
        return null;
    }
    return (
        <DawUtilitySection title="Suggestions" detail="Quick next moves suggested by the current analysis.">
            <Stack as="ul" gap={1}>
                {suggestions.map((state, index) => (
                    <Row
                        as="li"
                        align="start"
                        gap={1.5}
                        className="text-[10px] text-muted-foreground leading-tight"
                        key={index}
                    >
                        <span className="shrink-0 mt-0.5">•</span>
                        <span>{state}</span>
                    </Row>
                ))}
            </Stack>
        </DawUtilitySection>
    );
};
