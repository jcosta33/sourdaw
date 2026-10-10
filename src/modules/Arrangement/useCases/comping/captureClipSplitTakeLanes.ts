import { readTempoAtBeat } from '#/modules/Transport/stores';
import { type ClipSplitTakeLaneSnapshot } from '#/utils/handlerContract';

import { type Take, type TakeLane } from '../../models/TakeLane';
import { takeLaneStore } from '../../stores/takeLaneStore';
import { type Clip } from '../../stores/trackStore';

import { materializeTakeSourceDepth } from './materializeTakeSourceDepth';

/** Capture only the source clip's facets, before the resolved seam changes its geometry. */
export function captureClipSplitTakeLanes(
    clip: Clip,
    rightClipId: string,
    seam: number
): {
    previous: ClipSplitTakeLaneSnapshot;
    next: ClipSplitTakeLaneSnapshot;
} | null {
    const previous: TakeLane[] = [];
    const next: TakeLane[] = [];
    if (clip.type !== 'audio') {
        return { previous: { version: 1, lanes: previous }, next: { version: 1, lanes: next } };
    }
    const lanes = takeLaneStore.value?.lanes ?? [];
    const usedIds = new Set(lanes.flatMap((lane) => lane.takes.map((take) => take.id)));
    for (const lane of lanes) {
        if (lane.trackId !== clip.trackId) {
            continue;
        }
        const takes = lane.takes.filter((take) => take.clipId === clip.id);
        if (takes.length === 0) {
            continue;
        }
        const sourceIds = new Set(takes.map((take) => take.id));
        const regions = lane.activeCompRegions.filter((region) => sourceIds.has(region.takeId));
        const rightIds = new Map<string, string>();
        const after: Take[] = [];
        for (const take of takes) {
            if (take.endBeat <= seam) {
                after.push(take);
                continue;
            }
            const rightId = `${take.id}:split-right:${rightClipId}`;
            if (usedIds.has(rightId)) {
                return null;
            }
            usedIds.add(rightId);
            rightIds.set(take.id, rightId);
            if (take.startBeat < seam) {
                after.push({ ...take, endBeat: seam });
            }
            after.push({
                ...materializeTakeSourceDepth(take, readTempoAtBeat({ beat: clip.startBeat })),
                id: rightId,
                clipId: rightClipId,
                startBeat: Math.max(take.startBeat, seam),
                selected: take.selected && take.startBeat >= seam,
            });
        }
        const afterRegions = [];
        for (const region of regions) {
            if (region.startBeat < seam) {
                afterRegions.push({ ...region, endBeat: Math.min(region.endBeat, seam) });
            }
            if (region.endBeat > seam) {
                const takeId = rightIds.get(region.takeId);
                if (!takeId) {
                    return null;
                }
                afterRegions.push({ ...region, takeId, startBeat: Math.max(region.startBeat, seam) });
            }
        }
        previous.push({
            id: lane.id,
            trackId: lane.trackId,
            takes: structuredClone(takes),
            activeCompRegions: structuredClone(regions),
        });
        next.push({ id: lane.id, trackId: lane.trackId, takes: after, activeCompRegions: afterRegions });
    }
    return { previous: { version: 1, lanes: previous }, next: { version: 1, lanes: next } };
}
