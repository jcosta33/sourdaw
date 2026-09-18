import { type ReactElement, type Ref } from 'react';

import { Row, Stack } from '#/components/layout';
import { Button } from '#/components/ui/button';

type AgentComparisonSide = 'A' | 'B';

type AgentComparisonMeasurement = 'web-master' | 'unavailable-native-carrier' | 'unavailable-not-playing';

type AgentComparisonEndReason = 'user-ended' | 'project-changed' | 'group-reverted' | 'transition-failed' | 'left-on-a';

/** The active comparison fields this section renders, as a leaf-owned structural shape. */
type AgentComparisonActiveView = {
    side: AgentComparisonSide;
    loudness: { a: number | null; b: number | null };
    matchDb: number | null;
    matchLimited: boolean;
    measurement: AgentComparisonMeasurement;
    transitioning: boolean;
};

type AgentComparisonEndingView = {
    reason: AgentComparisonEndReason;
};

type AgentComparisonSectionProps = {
    active: AgentComparisonActiveView | null;
    /** Rendered only while `active` is null: what the previous comparison closed with. */
    lastEnded: AgentComparisonEndingView | null;
    /** The compared group's prompt; only read while `active` is non-null. */
    prompt: string;
    toggleRef?: Ref<HTMLButtonElement>;
    onToggleSide: () => void;
    onEnd: () => void;
};

const ENDING_TEXT: Record<AgentComparisonEndReason, string> = {
    'user-ended': 'Comparison ended; project on B (after)',
    'project-changed': 'Comparison ended: the project changed',
    'group-reverted': 'Comparison ended: the change was reverted',
    'transition-failed': 'Comparison ended: the side change failed; check undo history',
    'left-on-a': 'Comparison ended on A (before); redo to restore the change',
};

/** `+6.1` / `-2.0`: `toFixed` already carries the minus sign, only the plus needs adding. */
function formatSignedDb(value: number): string {
    const sign = value >= 0 ? '+' : '';
    return `${sign}${value.toFixed(1)}`;
}

function formatLoudness(lufs: number | null): string {
    if (lufs === null) {
        return 'measuring…';
    }
    return `${lufs.toFixed(1)} LUFS`;
}

function formatMatch(matchDb: number | null, matchLimited: boolean): string | null {
    if (matchDb === null) {
        return null;
    }
    const limitedNote = matchLimited ? ' (limited by fader headroom)' : '';
    return `Match: ${formatSignedDb(matchDb)} dB on A${limitedNote}`;
}

function formatMeasurementNote(measurement: AgentComparisonMeasurement): string | null {
    if (measurement === 'unavailable-not-playing') {
        return 'Start playback to measure loudness';
    }
    if (measurement === 'unavailable-native-carrier') {
        return 'Loudness match unavailable while the native engine carries the mix';
    }
    return null;
}

function formatStatus(active: AgentComparisonActiveView): string {
    if (active.transitioning) {
        return 'Switching sides';
    }
    const matchNote = active.matchDb === null ? '' : `, match ${formatSignedDb(active.matchDb)} dB`;
    return `Comparing side ${active.side}${matchNote}`;
}

export const AgentComparisonSection = ({
    active,
    lastEnded,
    prompt,
    toggleRef,
    onToggleSide,
    onEnd,
}: AgentComparisonSectionProps): ReactElement | null => {
    if (active === null) {
        if (lastEnded === null) {
            return null;
        }
        return (
            <Stack as="section" gap={1} aria-label="Agent comparison">
                <p className="text-xs text-muted-foreground" data-ending-reason={lastEnded.reason}>
                    {ENDING_TEXT[lastEnded.reason]}
                </p>
            </Stack>
        );
    }

    const matchText = formatMatch(active.matchDb, active.matchLimited);
    const measurementNote = formatMeasurementNote(active.measurement);

    return (
        <Stack
            as="section"
            gap={2}
            aria-label="Agent comparison"
            className="rounded border border-border/60 p-2 text-xs"
        >
            <h4 className="text-xs font-semibold text-foreground">A/B comparison</h4>
            <p className="text-foreground">{prompt}</p>
            <Row gap={2} align="center">
                <Button
                    type="button"
                    ref={toggleRef}
                    variant="ghost"
                    size="xs"
                    aria-pressed={active.side === 'A'}
                    aria-label="Switch comparison side"
                    data-side={active.side}
                    disabled={active.transitioning}
                    className="motion-reduce:transition-none"
                    onClick={onToggleSide}
                >
                    {active.side === 'A' ? 'A · before' : 'B · after'}
                    {active.transitioning ? <span aria-hidden> Switching…</span> : null}
                </Button>
            </Row>
            <p className="text-foreground">{`A: ${formatLoudness(active.loudness.a)}`}</p>
            <p className="text-foreground">{`B: ${formatLoudness(active.loudness.b)}`}</p>
            {matchText === null ? null : <p className="text-foreground">{matchText}</p>}
            {measurementNote === null ? null : <p className="text-muted-foreground">{measurementNote}</p>}
            <Row gap={1}>
                <Button
                    type="button"
                    size="xs"
                    variant="secondary"
                    aria-label="End comparison"
                    className="motion-reduce:transition-none"
                    onClick={onEnd}
                >
                    End comparison
                </Button>
            </Row>
            <p role="status" aria-live="polite" aria-atomic="true" className="text-muted-foreground">
                {formatStatus(active)}
            </p>
        </Stack>
    );
};
