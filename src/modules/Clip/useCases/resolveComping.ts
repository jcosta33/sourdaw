import { takeLaneStore } from '#/modules/Clip/stores/takeLaneStore';
import { type Clip } from '#/modules/Track/models/Track';

export type ResolvedClip = Clip & {
    regionStartBeat: number;
    regionEndBeat: number;
};

export function resolveClipsWithComping(trackId: string, clips: Clip[]): ResolvedClip[] {
    const laneState = takeLaneStore.value;
    if (!laneState) {
        return clips.map((c) => ({ ...c, regionStartBeat: c.startBeat, regionEndBeat: c.endBeat }));
    }

    const lane = laneState.lanes.find((l) => l.trackId === trackId);
    if (!lane || lane.activeCompRegions.length === 0) {
        return clips.map((c) => ({ ...c, regionStartBeat: c.startBeat, regionEndBeat: c.endBeat }));
    }

    const resolved: ResolvedClip[] = [];

    for (const region of lane.activeCompRegions) {
        const take = lane.takes.find((t) => t.id === region.takeId);
        if (!take) {
            continue;
        }

        const sourceClip = clips.find((c) => c.id === take.clipId);
        if (!sourceClip) {
            continue;
        }

        const overlapStart = Math.max(region.startBeat, sourceClip.startBeat);
        const overlapEnd = Math.min(region.endBeat, sourceClip.endBeat);
        if (overlapStart >= overlapEnd) {
            continue;
        }

        resolved.push({
            ...sourceClip,
            startBeat: overlapStart,
            endBeat: overlapEnd,
            regionStartBeat: overlapStart,
            regionEndBeat: overlapEnd,
        });
    }

    const sortedRegions = [...lane.activeCompRegions].sort((a, b) => a.startBeat - b.startBeat);

    for (const clip of clips) {
        const gaps: { start: number; end: number }[] = [];
        let cursor = clip.startBeat;

        for (const region of sortedRegions) {
            if (region.endBeat <= clip.startBeat || region.startBeat >= clip.endBeat) {
                continue;
            }
            const regionStart = Math.max(region.startBeat, clip.startBeat);
            if (cursor < regionStart) {
                gaps.push({ start: cursor, end: regionStart });
            }
            cursor = Math.max(cursor, Math.min(region.endBeat, clip.endBeat));
        }
        if (cursor < clip.endBeat) {
            gaps.push({ start: cursor, end: clip.endBeat });
        }

        for (const gap of gaps) {
            resolved.push({
                ...clip,
                startBeat: gap.start,
                endBeat: gap.end,
                regionStartBeat: gap.start,
                regionEndBeat: gap.end,
            });
        }
    }

    return resolved.sort((a, b) => a.startBeat - b.startBeat);
}
