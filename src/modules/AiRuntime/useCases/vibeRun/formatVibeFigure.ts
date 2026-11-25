import { withVibeUnit } from './withVibeUnit';

/** A measured figure at two trimmed decimals in its unit, or a dash where none was read. */
export function formatVibeFigure(value: number | undefined, unit: string | null): string {
    if (value === undefined) {
        return '—';
    }
    return withVibeUnit(value.toFixed(2).replace(/\.?0+$/u, ''), unit);
}
