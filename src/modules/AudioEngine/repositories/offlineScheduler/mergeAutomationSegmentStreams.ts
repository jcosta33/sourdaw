import { type OfflineAutomationSegment } from '../deviceStrategy/AudioDeviceStrategy';

/** One lane's compiled segment stream on the (device, parameter) pair being merged. */
export type AutomationSegmentStream = Readonly<{
    laneId: string;
    segments: readonly OfflineAutomationSegment[];
}>;

/**
 * `segments` is the single stream every kept lane on one device parameter
 * merges into — one stream per disjoint cluster the sweep below finds, with
 * exactly one survivor per cluster of two or more. `withheldLaneIds` names
 * every lane a cluster did not keep, in the original `streams` array order,
 * so a caller that must account for a withheld lane (the live producer, the
 * native export) does not have to re-derive who lost.
 */
export type MergedAutomationSegmentStreams = Readonly<{
    segments: readonly OfflineAutomationSegment[];
    withheldLaneIds: readonly string[];
}>;

/**
 * Merge every lane's compiled segment stream on one device parameter into the
 * single stream a "last apply wins" consumer (a worklet's `paramAutomation`,
 * the offline recording projection) can hold at once, withholding whichever
 * lanes in a genuinely overlapping cluster lose the tie-break — rather than
 * abandoning the whole group over one clashing pair and dropping lanes that
 * intersect nothing.
 *
 * Streams are sorted by first frame (ties broken by terminator frame
 * ascending — see below), then swept into clusters: a stream joins the
 * current cluster when its start frame is before the cluster's own running
 * maximum terminator frame seen so far, not merely the immediately preceding
 * stream's own terminator — a short stream nested entirely inside an earlier,
 * longer-running one must still join the cluster the longer stream opened,
 * even though the stream immediately before it (also nested, and shorter
 * still) ends earlier than the outer one does.
 *
 * A cluster of one stream is kept whole. A cluster of two or more keeps
 * exactly the one stream latest in the caller's original lane-array order —
 * the same "last apply wins" precedence a single non-clashing consumer would
 * have given every lane on this parameter — and withholds the rest, recording
 * each withheld lane's id once, in original lane-array order.
 *
 * The kept streams (one per cluster, in time order) are pairwise disjoint by
 * construction and merge exactly as before: the later one's first frame is at
 * or past the earlier one's zero-length terminator frame — the frame
 * `compileAutomationSegments` always closes a stream with, carrying the value
 * the lane last held. Merging them holds that value across the gap between
 * the terminator and the next stream's first frame, replacing the
 * terminator: nothing writes the parameter in that gap, live or offline, so
 * it keeps its last value there exactly as Web Audio's per-clip-window
 * `applyAutomation` does. A zero-width gap (the next stream starts exactly
 * where the previous one ended) drops the terminator instead of inserting a
 * zero-length hold next to it. The merged stream ends with the last kept
 * stream's own terminator, and — given only disjoint kept streams — stays
 * contiguous throughout: every accepted assertion in this file also holds for
 * `isContiguousAutomationSchedule` (`engine/ToasterNode.ts`), which
 * additionally requires the very first frame to be `0`; a caller merging
 * streams that do not open there must not present the result to that check.
 *
 * A clip whose window ends exactly at the region start compiles to a
 * zero-length stream — a lone terminator sitting at frame 0, carrying nothing
 * but the value to hold. When another stream also starts at frame 0, sorting
 * by start frame alone leaves their relative order wherever the caller's own
 * array happened to put them, and a zero-length stream landing after a real
 * one reads as starting inside it — an overlap that was never there. Ties on
 * start frame break by terminator frame ascending instead: the stream that
 * ends first (the zero-length one) sorts first, so it is what the next
 * stream's first frame is checked against, order-independently.
 */
export function mergeAutomationSegmentStreams(
    streams: readonly AutomationSegmentStream[]
): MergedAutomationSegmentStreams {
    const nonEmpty = streams.filter((stream) => stream.segments.length > 0);
    if (nonEmpty.length === 0) {
        return { segments: [], withheldLaneIds: [] };
    }

    const laneOrder = new Map<string, number>();
    for (const [index, stream] of streams.entries()) {
        laneOrder.set(stream.laneId, index);
    }

    const ordered = [...nonEmpty].sort((first, second) => {
        const startFrameDiff = first.segments[0]!.startFrame - second.segments[0]!.startFrame;
        if (startFrameDiff !== 0) {
            return startFrameDiff;
        }
        return first.segments.at(-1)!.endFrame - second.segments.at(-1)!.endFrame;
    });

    const clusters: AutomationSegmentStream[][] = [];
    let currentCluster: AutomationSegmentStream[] = [];
    let runningMaxTerminator = -Infinity;
    for (const stream of ordered) {
        const startFrame = stream.segments[0]!.startFrame;
        const terminatorFrame = stream.segments.at(-1)!.endFrame;
        if (currentCluster.length > 0 && startFrame < runningMaxTerminator) {
            currentCluster.push(stream);
            runningMaxTerminator = Math.max(runningMaxTerminator, terminatorFrame);
            continue;
        }
        if (currentCluster.length > 0) {
            clusters.push(currentCluster);
        }
        currentCluster = [stream];
        runningMaxTerminator = terminatorFrame;
    }
    if (currentCluster.length > 0) {
        clusters.push(currentCluster);
    }

    const withheldLaneIds: string[] = [];
    const kept: AutomationSegmentStream[] = [];
    for (const cluster of clusters) {
        if (cluster.length === 1) {
            kept.push(cluster[0]!);
            continue;
        }
        const keeper = cluster.reduce((latest, candidate) =>
            laneOrder.get(candidate.laneId)! > laneOrder.get(latest.laneId)! ? candidate : latest
        );
        kept.push(keeper);
        for (const stream of cluster) {
            if (stream !== keeper) {
                withheldLaneIds.push(stream.laneId);
            }
        }
    }
    withheldLaneIds.sort((first, second) => laneOrder.get(first)! - laneOrder.get(second)!);

    const merged: OfflineAutomationSegment[] = [];
    for (let index = 0; index < kept.length; index++) {
        const stream = kept[index]!.segments;
        if (index === kept.length - 1) {
            merged.push(...stream);
            break;
        }
        merged.push(...stream.slice(0, -1));
        const terminator = stream.at(-1)!;
        const nextFirst = kept[index + 1]!.segments[0]!;
        if (nextFirst.startFrame > terminator.endFrame) {
            merged.push({
                startFrame: terminator.endFrame,
                endFrame: nextFirst.startFrame,
                startValue: terminator.endValue,
                endValue: terminator.endValue,
            });
        }
    }
    return { segments: merged, withheldLaneIds };
}
