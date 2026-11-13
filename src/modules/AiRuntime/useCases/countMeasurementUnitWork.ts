import { type MeasurementWork } from '../models/MeasurementBudget';

import { type MeasurementScope as Scope, type MeasurementUnit } from './planMetricMeasurementRequests';
import { readGroupPrefixes } from './readGroupPrefixes';
import { readMeasurementRenderedSeconds } from './readMeasurementRenderedSeconds';

type UnitWork = MeasurementWork & { renderedSeconds: number };

function scopeTargets(scope: Scope): string[] {
    return scope.kind === 'master' ? ['master'] : scope.ids;
}

/**
 * What one unit spends: each target renders once per group in the live project plus once per
 * prefix document read in that group, and reduces once per read. `renderedSeconds` is the mean
 * seconds those renders process, so renders times it is the total the wall-clock allowance reads.
 */
export function countMeasurementUnitWork(unit: MeasurementUnit): UnitWork {
    const targets = scopeTargets(unit.scope).length;
    let renderJobs = 0;
    let processedSeconds = 0;
    for (const group of unit.groups) {
        const renders = targets * (1 + readGroupPrefixes(unit, group).length);
        renderJobs += renders;
        processedSeconds += renders * readMeasurementRenderedSeconds(group.endBeat);
    }
    return {
        renderJobs,
        analyses: targets * unit.reads.length,
        renderedSeconds: renderJobs === 0 ? 0 : processedSeconds / renderJobs,
    };
}
