import { executeUserAppAction } from '#/modules/Command/useCases';

import { type CompRegion } from '../../models/TakeLane';

import { compRegionInterval } from './compRegionInterval';

export function setCompRegion(trackId: string, region: CompRegion): void {
    if (!compRegionInterval.capturePatch({ trackId, ...region })) {
        return;
    }
    void executeUserAppAction({
        type: 'setCompRegion',
        payload: { trackId, startBeat: region.startBeat, endBeat: region.endBeat, takeId: region.takeId },
    });
}
