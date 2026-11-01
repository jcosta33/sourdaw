import { timelineMapTimeStateCodec } from './timelineMapTimeStateCodec';

/** Validate persisted owner syntax without consulting the current timeline map. */
export function isValidTimelineMapStateRestorePlan(value: unknown): boolean {
    return timelineMapTimeStateCodec.decodeRestorePlan(value) !== null;
}
