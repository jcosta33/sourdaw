import { type OfflineRenderProjectSource } from './OfflineRenderSource';

type TakeLane = NonNullable<OfflineRenderProjectSource['takeLanes']>['lanes'][number];

/**
 * A take lane with each take without the fields no render reads: its label and whether it is the
 * selected one. Comping reads a take by its id, clip, range and media, and which take sounds is the
 * lane's comp regions.
 */
export function readPrintedTakeLane(lane: TakeLane) {
    return {
        ...lane,
        takes: lane.takes.map((take) => {
            const { name: _name, selected: _selected, ...read } = take;
            return read;
        }),
    };
}
