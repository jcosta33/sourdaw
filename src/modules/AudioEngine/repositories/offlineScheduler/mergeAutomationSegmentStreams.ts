import { type OfflineAutomationSegment } from '../deviceStrategy/AudioDeviceStrategy';

/**
 * `overlapping: false` carries the single stream every disjoint lane on one
 * device parameter merges into; `overlapping: true` carries nothing, because
 * the caller's own per-lane fallback (today's behaviour) already has what it
 * needs — the original streams it was handed.
 */
export type MergedAutomationSegmentStreams =
    | { readonly overlapping: false; readonly segments: readonly OfflineAutomationSegment[] }
    | { readonly overlapping: true };

/**
 * Merge every lane's compiled segment stream on one device parameter into the
 * single stream a "last apply wins" consumer (a worklet's `paramAutomation`,
 * the offline recording projection) can hold at once — or report that the
 * lanes overlap, so the caller keeps applying each stream separately exactly
 * as it always has.
 *
 * Two streams are disjoint when the later one's first frame is at or past the
 * earlier one's zero-length terminator frame — the frame `compileAutomationSegments`
 * always closes a stream with, carrying the value the lane last held. Merging
 * them holds that value across the gap between the terminator and the next
 * stream's first frame, replacing the terminator: nothing writes the
 * parameter in that gap, live or offline, so it keeps its last value there
 * exactly as Web Audio's per-clip-window `applyAutomation` does. A zero-width
 * gap (the next stream starts exactly where the previous one ended) drops the
 * terminator instead of inserting a zero-length hold next to it. The merged
 * stream ends with the last stream's own terminator, and — given only
 * disjoint streams — stays contiguous throughout: every accepted assertion in
 * this file also holds for `isContiguousAutomationSchedule`
 * (`engine/ToasterNode.ts`), which additionally requires the very first frame
 * to be `0`; a caller merging streams that do not open there must not present
 * the result to that check.
 *
 * Any streams found overlapping — the later one starts before the earlier
 * one's terminator — abandon the merge for the whole group: there is no
 * general way to interleave two schedules that both claim the same frame.
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
    streams: ReadonlyArray<readonly OfflineAutomationSegment[]>
): MergedAutomationSegmentStreams {
    const nonEmpty = streams.filter((stream) => stream.length > 0);
    if (nonEmpty.length === 0) {
        return { overlapping: false, segments: [] };
    }
    const ordered = [...nonEmpty].sort((first, second) => {
        const startFrameDiff = first[0]!.startFrame - second[0]!.startFrame;
        return startFrameDiff !== 0 ? startFrameDiff : first.at(-1)!.endFrame - second.at(-1)!.endFrame;
    });
    for (let index = 1; index < ordered.length; index++) {
        const previousTerminator = ordered[index - 1]!.at(-1)!;
        const nextFirst = ordered[index]![0]!;
        if (nextFirst.startFrame < previousTerminator.endFrame) {
            return { overlapping: true };
        }
    }

    const merged: OfflineAutomationSegment[] = [];
    for (let index = 0; index < ordered.length; index++) {
        const stream = ordered[index]!;
        if (index === ordered.length - 1) {
            merged.push(...stream);
            break;
        }
        merged.push(...stream.slice(0, -1));
        const terminator = stream.at(-1)!;
        const nextFirst = ordered[index + 1]![0]!;
        if (nextFirst.startFrame > terminator.endFrame) {
            merged.push({
                startFrame: terminator.endFrame,
                endFrame: nextFirst.startFrame,
                startValue: terminator.endValue,
                endValue: terminator.endValue,
            });
        }
    }
    return { overlapping: false, segments: merged };
}
