import { modulationParamSlew, modulationSlewEpoch } from './modulationSlewState';

/**
 * Clears all per-param slew state. The slew map is module-level (it must survive
 * across scheduler ticks to ramp smoothly), so a test exercising the slew path
 * must reset it between cases or a prior case's seeded value leaks in and
 * suppresses the next write. Not used on the runtime hot path.
 */
export function resetModulationSlew(): void {
    modulationParamSlew.clear();
    modulationSlewEpoch.last = undefined;
}
