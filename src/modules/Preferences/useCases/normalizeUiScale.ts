import { normalizeUiScale as normalizePreferenceModelUiScale } from '../models/Preferences';

export function normalizeUiScale(value: unknown): number {
    return normalizePreferenceModelUiScale(value);
}
