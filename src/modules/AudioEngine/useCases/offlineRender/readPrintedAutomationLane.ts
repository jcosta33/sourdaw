import { type OfflineRenderProjectSource } from './OfflineRenderSource';

type AutomationLane = OfflineRenderProjectSource['automationLanes'][number];

/**
 * The automation lane fields the offline scheduler reads: which parameter a lane drives and on
 * which clip (`parameterId`, `trackId`, `clipId`), its curve and range (`points`, `minValue`,
 * `maxValue`), whether it plays (`enabled`) and the lane it follows (`linkedLaneId`, `linkScale`).
 * Every other field (its name, trim, ghost and object layers, clip mode, and how it is drawn) has no
 * reader in the offline render. Reading by an allowlist keeps a new lane field out of the print
 * until a reader needs it.
 */
export function readPrintedAutomationLane(lane: AutomationLane) {
    return {
        id: lane.id,
        trackId: lane.trackId,
        clipId: lane.clipId,
        parameterId: lane.parameterId,
        points: lane.points,
        minValue: lane.minValue,
        maxValue: lane.maxValue,
        enabled: lane.enabled,
        linkedLaneId: lane.linkedLaneId,
        linkScale: lane.linkScale,
    };
}
