import { readTempoAtBeat } from '#/modules/Transport/stores';

import { type Clip } from '../../models/Track';
import { type ClipSatelliteStateRestorePlan } from '../../stores/clipSatelliteState';
import { audioSourceAtBeat } from '../clipEditing/audioSourceAtBeat';
import { prepareClipSplitSatellites } from '../clipEditing/splitClipSatellites';

type InsertedAudioSplit = { source: Clip; rightClipId: string };
type AutomationCopy = ReturnType<typeof prepareClipSplitSatellites>['rightAutomationLanes'][number];

function shiftCopy(copy: AutomationCopy, durationBeats: number): AutomationCopy {
    const shiftPoint = <Point extends { beat: number }>(point: Point): Point => ({
        ...point,
        beat: point.beat + durationBeats,
    });
    const shifted: AutomationCopy = {
        ...copy,
        points: copy.points.map(shiftPoint),
    };
    if (copy.trimPoints !== undefined) {
        shifted.trimPoints = copy.trimPoints.map(shiftPoint);
    }
    if (copy.ghostPoints !== undefined) {
        shifted.ghostPoints = copy.ghostPoints.map(shiftPoint);
    }
    return shifted;
}

/** Split satellites against the old map, then place the copied automation in the post-insert frame. */
export function prepareInsertedAudioSatellites(input: {
    splits: readonly InsertedAudioSplit[];
    seamBeat: number;
    durationBeats: number;
}): {
    plan: ClipSatelliteStateRestorePlan;
    laneCopies: readonly AutomationCopy[];
    preservedClipIds: readonly string[];
} {
    const expected: ClipSatelliteStateRestorePlan['expected']['entries'][number][] = [];
    const replacement: ClipSatelliteStateRestorePlan['replacement']['entries'][number][] = [];
    const laneCopies: AutomationCopy[] = [];
    const preservedClipIds: string[] = [];
    for (const { source, rightClipId } of input.splits) {
        const rightSource = audioSourceAtBeat(source, input.seamBeat);
        const contentSplitBeats = (rightSource.audioOffsetSeconds * readTempoAtBeat({ beat: source.startBeat })) / 60;
        const split = prepareClipSplitSatellites({
            clipId: source.id,
            rightClipId,
            clipRelativeSplitBeats: input.seamBeat - source.startBeat,
            contentSplitBeats,
            absoluteSplitBeats: input.seamBeat,
        });
        expected.push(...split.previous);
        replacement.push(...split.next);
        laneCopies.push(...split.rightAutomationLanes.map((copy) => shiftCopy(copy, input.durationBeats)));
        preservedClipIds.push(source.id);
    }
    return {
        plan: {
            version: 1,
            expected: { version: 1, entries: expected },
            replacement: { version: 1, entries: replacement },
        },
        laneCopies,
        preservedClipIds,
    };
}
