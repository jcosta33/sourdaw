import {
    type MeasurementRange as Range,
    type MeasurementRenderGroup,
    type MeasurementUnit,
} from './planMetricMeasurementRequests';

function rangeKey(range: Range): string {
    return JSON.stringify([range.startBeat, range.endBeat, range.sectionId]);
}

/** The prefix documents a preview unit renders in one group: each one read over a range the group covers. */
export function readGroupPrefixes(unit: MeasurementUnit, group: MeasurementRenderGroup): string[] {
    if (unit.subject === 'project') {
        return [];
    }
    const keys = new Set(group.ranges.map(rangeKey));
    return unit.prefixes.filter((prefix) =>
        unit.reads.some((read) => read.prefix === prefix && keys.has(rangeKey(read.range)))
    );
}
