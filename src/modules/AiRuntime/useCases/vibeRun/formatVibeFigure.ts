/** A measured figure at two trimmed decimals in its unit, or a dash where none was read. */
export function formatVibeFigure(value: number | undefined, unit: string | null): string {
    if (value === undefined) {
        return '—';
    }
    const shown = value.toFixed(2).replace(/\.?0+$/u, '');
    if (unit === null || unit === 'ratio' || unit === 'count' || unit === 'correlation') {
        return shown;
    }
    return `${shown} ${unit === 'hertz' ? 'Hz' : unit}`;
}
