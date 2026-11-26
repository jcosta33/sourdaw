import { listPrintedFieldRefs } from './listPrintedFieldRefs';
import { type OfflineRenderProjectSource } from './OfflineRenderSource';
import { readPrintedTakeLane } from './readPrintedTakeLane';

/** The references a lane's print reads: its own fields, then each take's printed fields. */
export function listPrintedTakeLaneRefs(lane: NonNullable<OfflineRenderProjectSource['takeLanes']>['lanes'][number]) {
    const { takes, ...own } = readPrintedTakeLane(lane);
    return [...listPrintedFieldRefs(own), ...takes.flatMap(listPrintedFieldRefs)];
}
