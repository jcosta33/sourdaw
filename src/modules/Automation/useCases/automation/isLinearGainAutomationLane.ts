import { type AutomationLane } from '../../models/Automation';

/**
 * Whether a lane's stored values are linear gain amplitudes.
 *
 * `parameterId: 'gain'` alone does not settle it. A gain lane whose `minValue`
 * is negative is a **decibel** lane — `automationScheduling.ts` reads exactly
 * that predicate and applies `dbToGain(value)` before the value reaches the
 * engine — so its points are already decibels. Treating one as an amplitude
 * (or offering to convert decibels into it) would write a number in the wrong
 * unit, silently and inaudibly until playback.
 */
export function isLinearGainAutomationLane(lane: Pick<AutomationLane, 'parameterId' | 'minValue'>): boolean {
    return lane.parameterId === 'gain' && lane.minValue >= 0;
}
