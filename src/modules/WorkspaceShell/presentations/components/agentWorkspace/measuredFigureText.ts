type Figure = { value: number; unit: string };

/** How a measured target is named to the musician: its live track name, else Master, else its id. */
export function measuredTargetName(target: {
    targetId: string;
    targetKind: 'master' | 'track' | 'bus';
    targetName: string | null;
}): string {
    if (target.targetName !== null) {
        return target.targetName;
    }
    return target.targetKind === 'master' ? 'Master' : target.targetId;
}

/** One measured figure as every agent surface states it, so a plan and its approval card read alike. */
export function formatFigure(figure: Figure | null): string {
    return figure === null ? 'n/a' : `${figure.value.toFixed(2)} ${figure.unit}`;
}

/** A signed change in the same format, a plus sign only for an increase. */
export function formatSignedDelta(delta: Figure): string {
    const sign = delta.value > 0 ? '+' : '';
    return `${sign}${delta.value.toFixed(2)} ${delta.unit}`;
}

/** A measured beat range as the approval card's criteria state it. */
export function formatBeatRange(range: { startBeat: number; endBeat: number }): string {
    return `beats ${String(range.startBeat)}–${String(range.endBeat)}`;
}
