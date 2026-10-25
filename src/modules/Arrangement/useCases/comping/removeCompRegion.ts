import { executeUserAppAction } from '#/modules/Command/useCases';

import { compRegionInterval } from './compRegionInterval';

export function removeCompRegion(trackId: string, startBeat: number): void {
    const patch = compRegionInterval.captureRemovePatch({ trackId, startBeat });
    if (!patch || !compRegionInterval.patchApplies(patch)) return;
    void executeUserAppAction({ type: 'removeCompRegion', payload: { trackId, startBeat } });
}
