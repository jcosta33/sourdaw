import { OBJECTIVE_METRIC_LABELS } from '../objectiveMetricProjection';

/** A metric as a card names it, with its band when it has one. */
export function readVibeMetricLabel(metric: string | null, band: string | null): string {
    const label =
        Object.entries(OBJECTIVE_METRIC_LABELS).find(([id]) => id === metric)?.[1] ?? metric ?? 'unknown metric';
    return band === null ? label : `${label} (${band})`;
}
