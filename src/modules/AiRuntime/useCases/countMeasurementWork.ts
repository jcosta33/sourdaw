import { type MeasurementWork } from '../models/MeasurementBudget';

import { countMeasurementUnitWork } from './countMeasurementUnitWork';
import { type MeasurementUnit } from './planMetricMeasurementRequests';

/** The renders and reductions a set of units spends, counted unit by unit. */
export function countMeasurementWork(units: readonly MeasurementUnit[]): MeasurementWork {
    return units.reduce(
        (total, unit) => {
            const work = countMeasurementUnitWork(unit);
            return { renderJobs: total.renderJobs + work.renderJobs, analyses: total.analyses + work.analyses };
        },
        { renderJobs: 0, analyses: 0 }
    );
}
