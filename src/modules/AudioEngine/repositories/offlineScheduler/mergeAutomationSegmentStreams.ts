import { type OfflineAutomationSegment } from '../deviceStrategy/AudioDeviceStrategy';

/**
 * The scope a lane drives its parameter from, and the whole of the resolution
 * law's input: a clip-scoped lane is the more specific owner, so it beats a
 * track-level lane on every span their streams share (#4736) — the Bitwig /
 * Studio One / Logic convention that clip automation overrides track
 * automation while the clip plays.
 */
export type AutomationSegmentScope = 'clip' | 'track';

/** One lane's compiled segment stream on the (device, parameter) pair being merged. */
export type AutomationSegmentStream = Readonly<{
    laneId: string;
    scope: AutomationSegmentScope;
    segments: readonly OfflineAutomationSegment[];
    /**
     * A clip-scoped lane's scope window end, in this merge's frame domain —
     * the clip's last frame inside the region, on the same clock (including
     * any compensation shift) as the segments themselves. The compiled
     * material ends where the lane's last point (plus slew settle) lands,
     * not where its clip does, so the merge stretches a windowed stream's
     * extent out to this frame before resolving. A track lane carries none:
     * its compiled extent stays its ownership.
     */
    windowEndFrame?: number;
}>;

/**
 * Every lane on the (device, parameter) pair resolves into one merged stream —
 * there is no withholding left to report. The field stays because the
 * contract's callers (the live producer, the native export) still read it;
 * under the scope law it is always empty.
 */
export type MergedAutomationSegmentStreams = Readonly<{
    segments: readonly OfflineAutomationSegment[];
    withheldLaneIds: readonly string[];
}>;

/**
 * The value a segment carries at a frame inside it. A zero-length segment (a
 * stream's closing terminator, or two events that rounded onto one frame) is
 * a constant; anything else is the linear ramp the consumers evaluate.
 */
function segmentValueAt(segment: OfflineAutomationSegment, frame: number): number {
    if (segment.endFrame <= segment.startFrame) {
        return segment.startValue;
    }
    const fraction = (frame - segment.startFrame) / (segment.endFrame - segment.startFrame);
    return segment.startValue + (segment.endValue - segment.startValue) * fraction;
}

/**
 * One lane's precedence on a shared span: the more specific scope wins, and
 * equal scopes break to the lane latest in the caller's array order — the
 * same "last apply wins" precedence a single non-clashing consumer would
 * have given every lane on this parameter.
 */
function outranks(
    candidate: AutomationSegmentStream,
    incumbent: AutomationSegmentStream,
    laneOrder: ReadonlyMap<string, number>
): boolean {
    if (candidate.scope !== incumbent.scope) {
        return candidate.scope === 'clip';
    }
    return laneOrder.get(candidate.laneId)! > laneOrder.get(incumbent.laneId)!;
}

/**
 * One owner's material clipped to `[start, end]`.
 *
 * The stream is internally contiguous, so the clipped pieces tile the span:
 * each real segment contributes its overlap, with the ramp value interpolated
 * at a boundary that cuts through it, and each zero-length segment inside the
 * span (including the owner's closing terminator at its far end) is carried
 * through whole — which is what keeps the merged output ending in a
 * terminator.
 */
function clipStreamToSpan(stream: AutomationSegmentStream, start: number, end: number): OfflineAutomationSegment[] {
    const clipped: OfflineAutomationSegment[] = [];
    for (const segment of stream.segments) {
        if (segment.startFrame === segment.endFrame) {
            if (segment.startFrame >= start && segment.startFrame <= end) {
                clipped.push(segment);
            }
            continue;
        }
        const clippedStart = Math.max(segment.startFrame, start);
        const clippedEnd = Math.min(segment.endFrame, end);
        if (clippedEnd <= clippedStart) {
            continue;
        }
        clipped.push({
            startFrame: clippedStart,
            endFrame: clippedEnd,
            startValue: segmentValueAt(segment, clippedStart),
            endValue: segmentValueAt(segment, clippedEnd),
        });
    }
    return clipped;
}

/**
 * Hold a clip stream's closing value out to its scope window's end.
 *
 * A clip lane's compiled stream ends where its last point (plus slew settle)
 * lands, not where its clip does — but the scope law gives the lane every
 * frame of its clip window (#4736). A stream carrying `windowEndFrame`
 * therefore has its closing terminator replaced by a hold out to that frame
 * and a fresh terminator there, so its extent covers its window and the
 * per-span resolution below hands it the whole window: a lane whose points
 * stop mid-clip keeps owning the tail, a one-point lane owns its window from
 * its single value, and the splice frames follow the window rather than
 * value-dependent settle distances. Track lanes carry no window and pass
 * through untouched, which is what keeps their extent-based law where it
 * already resolved correctly. `compileAutomationEvents` opens every stream
 * at its window's start, so only the far end needs carrying.
 */
function extendStreamToWindowEnd(stream: AutomationSegmentStream): AutomationSegmentStream {
    const last = stream.segments.at(-1)!;
    if (stream.windowEndFrame === undefined || stream.windowEndFrame <= last.endFrame) {
        return stream;
    }
    // Every compiled stream closes on a zero-length terminator, so replacing
    // it keeps the stream contiguous and still ending on one.
    return {
        ...stream,
        segments: [
            ...stream.segments.slice(0, -1),
            {
                startFrame: last.endFrame,
                endFrame: stream.windowEndFrame,
                startValue: last.endValue,
                endValue: last.endValue,
            },
            {
                startFrame: stream.windowEndFrame,
                endFrame: stream.windowEndFrame,
                startValue: last.endValue,
                endValue: last.endValue,
            },
        ],
    };
}

/**
 * Merge every lane's compiled segment stream on one device parameter into the
 * single stream a one-schedule-per-parameter consumer (a worklet's
 * `paramAutomation`, the offline recording projection) can hold — resolving
 * overlap by the scope law instead of abandoning lanes, and keeping every
 * lane's material on the spans it owns.
 *
 * Streams are sorted by first frame (ties broken by terminator frame
 * ascending), then swept into clusters: a stream joins the current cluster
 * when its start frame is before the cluster's running maximum terminator
 * frame — a short stream nested entirely inside an earlier, longer-running
 * one joins the cluster the longer stream opened. A cluster of one stream is
 * kept whole. Inside a cluster of two or more, every span between the
 * clusters' boundary frames is owned by exactly one lane: the most specific
 * scope covering the span — a clip-scoped lane over a track-level lane,
 * while the clip plays (#4736) — and, at equal scope, the lane latest in the
 * caller's array order. The winner's material is clipped to the span and the
 * pieces concatenate in time order, so a track lane's leading hold (before
 * its first point) and its trailing terminator are spans like any other and
 * the outcome is independent of which lane comes first in time (#4749). A
 * stream that compiles to a lone zero-length terminator covers only its own
 * frame; on a span another stream covers it contributes nothing.
 *
 * Before the sweep, a stream carrying a clip scope window
 * (`windowEndFrame` — see `extendStreamToWindowEnd`) is stretched to that
 * frame, so a clip lane's extent is its window and the per-span ownership
 * above hands it every frame of the window the law gives it, however early
 * its own points stop.
 *
 * The kept clusters (in time order) are pairwise disjoint by construction and
 * merge exactly as before: the later one's first frame is at or past the
 * earlier one's zero-length terminator frame — the frame
 * `compileAutomationSegments` always closes a stream with, carrying the value
 * the lane last held. Merging them holds that value across the gap between
 * the terminator and the next cluster's first frame, replacing the
 * terminator: nothing writes the parameter in that gap, live or offline, so
 * it keeps its last value there exactly as Web Audio's per-clip-window
 * `applyAutomation` does. A zero-width gap drops the terminator instead of
 * inserting a zero-length hold next to it. The merged stream stays
 * contiguous throughout and ends with a zero-length terminator, so every
 * accepted assertion here also holds for `isContiguousAutomationSchedule`
 * (`engine/ToasterNode.ts`) — which, since #4744, accepts streams opening at
 * any non-negative frame, as every merged stream here may.
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
/**
 * Sweep the time-ordered streams into overlap clusters: a stream joins the
 * running cluster when its start frame is before the cluster's running
 * maximum terminator frame, and opens a new cluster otherwise.
 */
function clusterStreams(ordered: readonly AutomationSegmentStream[]): AutomationSegmentStream[][] {
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
    return clusters;
}

/**
 * Resolve one cluster of two or more overlapping streams by the scope law:
 * every span between the clusters' boundary frames goes to the most specific
 * stream covering it, and the winners' clipped pieces concatenate in time
 * order.
 */
function resolveClusterByScope(
    cluster: readonly AutomationSegmentStream[],
    laneOrder: ReadonlyMap<string, number>
): OfflineAutomationSegment[] {
    const boundaries = new Set<number>();
    for (const stream of cluster) {
        boundaries.add(stream.segments[0]!.startFrame);
        boundaries.add(stream.segments.at(-1)!.endFrame);
    }
    const frames = [...boundaries].sort((first, second) => first - second);
    const material: OfflineAutomationSegment[] = [];
    for (let index = 0; index < frames.length - 1; index++) {
        const start = frames[index]!;
        const end = frames[index + 1]!;
        let owner: AutomationSegmentStream | undefined;
        for (const stream of cluster) {
            if (stream.segments[0]!.startFrame > start || stream.segments.at(-1)!.endFrame < end) {
                continue;
            }
            if (owner === undefined || outranks(stream, owner, laneOrder)) {
                owner = stream;
            }
        }
        if (owner !== undefined) {
            material.push(...clipStreamToSpan(owner, start, end));
        }
    }
    return material;
}

/**
 * Splice the kept clusters (in time order) into one contiguous stream,
 * holding each cluster's terminator value across the gap to the next one.
 */
function spliceKeptMaterial(
    keptMaterial: readonly (readonly OfflineAutomationSegment[])[]
): OfflineAutomationSegment[] {
    const merged: OfflineAutomationSegment[] = [];
    for (let index = 0; index < keptMaterial.length; index++) {
        const material = keptMaterial[index]!;
        if (index === keptMaterial.length - 1) {
            merged.push(...material);
            break;
        }
        merged.push(...material.slice(0, -1));
        const terminator = material.at(-1)!;
        const nextFirst = keptMaterial[index + 1]![0]!;
        if (nextFirst.startFrame > terminator.endFrame) {
            merged.push({
                startFrame: terminator.endFrame,
                endFrame: nextFirst.startFrame,
                startValue: terminator.endValue,
                endValue: terminator.endValue,
            });
        }
    }
    return merged;
}

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

    const ordered = nonEmpty.map(extendStreamToWindowEnd).sort((first, second) => {
        const startFrameDiff = first.segments[0]!.startFrame - second.segments[0]!.startFrame;
        if (startFrameDiff !== 0) {
            return startFrameDiff;
        }
        return first.segments.at(-1)!.endFrame - second.segments.at(-1)!.endFrame;
    });

    const clusters = clusterStreams(ordered);

    // One owner per span inside a cluster; single-stream clusters carry their
    // own material whole. Nothing is withheld: the law resolves every span.
    const keptMaterial: OfflineAutomationSegment[][] = [];
    for (const cluster of clusters) {
        keptMaterial.push(cluster.length === 1 ? [...cluster[0]!.segments] : resolveClusterByScope(cluster, laneOrder));
    }

    return { segments: spliceKeptMaterial(keptMaterial), withheldLaneIds: [] };
}
