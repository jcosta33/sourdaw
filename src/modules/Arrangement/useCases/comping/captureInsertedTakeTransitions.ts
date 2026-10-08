import { readTempoAtBeat } from '#/modules/Transport/stores';

import { type CompRegion, type Take } from '../../models/TakeLane';
import { takeLaneStore } from '../../stores/takeLaneStore';

import { materializeTakeSourceDepth } from './materializeTakeSourceDepth';
import { type TakeReKeyLaneTransition } from './takeReKeyTransition';

type ClipGeometry = { id: string; startBeat: number; endBeat: number; type: 'audio' | 'midi' };
type Owner = { id: string; clips: readonly { source: ClipGeometry }[] };
type AfterTrack = { id: string; clips: readonly ClipGeometry[] };

type InsertedTakeCapture = {
    owners: readonly Owner[];
    afterTracks: readonly AfterTrack[];
    atBeat: number;
    durationBeats: number;
    copyTargets?: ReadonlyMap<string, string>;
};

/** Keep source depth at the original clip's tempo, even when its new beat lands past a marker. */
function movedTake(take: Take, clip: ClipGeometry, atBeat: number, durationBeats: number): Take {
    if (clip.type !== 'audio' || clip.startBeat < atBeat) {
        return take;
    }
    const source = materializeTakeSourceDepth(take, readTempoAtBeat({ beat: clip.startBeat }));
    return {
        ...source,
        startBeat: take.startBeat + durationBeats,
        endBeat: take.endBeat + durationBeats,
    };
}

function movedRegion(
    region: CompRegion,
    clip: ClipGeometry | undefined,
    atBeat: number,
    durationBeats: number
): CompRegion {
    if (!clip || clip.type !== 'audio' || clip.startBeat < atBeat) {
        return region;
    }
    return {
        ...region,
        startBeat: region.startBeat + durationBeats,
        endBeat: region.endBeat + durationBeats,
    };
}

function copiedRegionsForTake(
    regions: readonly CompRegion[],
    takeId: string,
    copyId: string,
    clip: ClipGeometry,
    displacement: number
): CompRegion[] {
    return regions.flatMap((region) => {
        if (region.takeId !== takeId) {
            return [];
        }
        const startBeat = Math.max(region.startBeat, clip.startBeat);
        const endBeat = Math.min(region.endBeat, clip.endBeat);
        if (startBeat >= endBeat) {
            return [];
        }
        return [{ startBeat: startBeat + displacement, endBeat: endBeat + displacement, takeId: copyId }];
    });
}

/** Capture the insert leg of insert/duplicate time, including a duplicate's new take and comp. */
export function captureInsertedTakeTransitions(input: InsertedTakeCapture): readonly TakeReKeyLaneTransition[] {
    const state = takeLaneStore.value;
    if (!state) {
        return [];
    }
    const beforeByTrack = new Map(
        input.owners.map((owner) => [owner.id, new Map(owner.clips.map(({ source }) => [source.id, source]))] as const)
    );
    const afterByTrack = new Map(
        input.afterTracks.map((track) => [track.id, new Map(track.clips.map((clip) => [clip.id, clip]))] as const)
    );
    const transitions: TakeReKeyLaneTransition[] = [];
    for (const lane of state.lanes) {
        const beforeClips = beforeByTrack.get(lane.trackId);
        const afterClips = afterByTrack.get(lane.trackId);
        if (!beforeClips || !afterClips) {
            continue;
        }
        const takeById = new Map(lane.takes.map((take) => [take.id, take]));
        let changed = false;
        const takesAfter: Take[] = lane.takes.map((take) => {
            const clip = beforeClips.get(take.clipId);
            if (!clip || !afterClips.has(clip.id)) {
                return take;
            }
            const moved = movedTake(take, clip, input.atBeat, input.durationBeats);
            changed ||= moved !== take;
            return moved;
        });
        const regionsAfter: CompRegion[] = lane.activeCompRegions.map((region) => {
            const take = takeById.get(region.takeId);
            const moved = movedRegion(
                region,
                take ? beforeClips.get(take.clipId) : undefined,
                input.atBeat,
                input.durationBeats
            );
            changed ||= moved !== region;
            return moved;
        });

        if (input.copyTargets) {
            for (const take of lane.takes) {
                const clip = beforeClips.get(take.clipId);
                const targetId = input.copyTargets.get(take.clipId);
                const target = targetId ? afterClips.get(targetId) : undefined;
                if (!clip || clip.type !== 'audio' || !target) {
                    continue;
                }
                changed = true;
                const depth = materializeTakeSourceDepth(take, readTempoAtBeat({ beat: clip.startBeat }));
                const copyId = `${take.id}:time-duplicate:${target.id}`;
                const displacement = target.startBeat - clip.startBeat;
                takesAfter.push({
                    ...depth,
                    id: copyId,
                    clipId: target.id,
                    startBeat: take.startBeat + displacement,
                    endBeat: take.endBeat + displacement,
                });
                regionsAfter.push(...copiedRegionsForTake(lane.activeCompRegions, take.id, copyId, clip, displacement));
            }
        }
        if (!changed) {
            continue;
        }
        regionsAfter.sort((left, right) => left.startBeat - right.startBeat || left.endBeat - right.endBeat);
        transitions.push({
            laneId: lane.id,
            trackId: lane.trackId,
            takesBefore: lane.takes,
            takesAfter,
            regionsBefore: lane.activeCompRegions,
            regionsAfter,
        });
    }
    return transitions;
}
