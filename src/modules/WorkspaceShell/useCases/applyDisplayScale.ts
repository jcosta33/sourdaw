import { normalizeUiScale } from '#/modules/Preferences/useCases';

import { setDisplayScale } from '../repositories/setDisplayScale';

export function applyDisplayScale(scale: number): void {
    setDisplayScale(normalizeUiScale(scale));
}
