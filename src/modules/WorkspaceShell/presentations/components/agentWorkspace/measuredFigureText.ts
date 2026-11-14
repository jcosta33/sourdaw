type Figure = { value: number; unit: string };

/** One measured figure as every agent surface states it, so a plan and its approval card read alike. */
export function formatFigure(figure: Figure | null): string {
    return figure === null ? 'n/a' : `${figure.value.toFixed(2)} ${figure.unit}`;
}

/** A signed change in the same format, a plus sign only for an increase. */
export function formatSignedDelta(delta: Figure): string {
    const sign = delta.value > 0 ? '+' : '';
    return `${sign}${delta.value.toFixed(2)} ${delta.unit}`;
}
