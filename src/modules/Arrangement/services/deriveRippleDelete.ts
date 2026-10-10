import { type Clip } from '../models/Track';

type RippleDeleteShift = {
    clipId: string;
    origStartBeat: number;
    origEndBeat: number;
    automationDelta: number;
};

type RippleDeleteInput<TClip> = {
    clips: readonly TClip[];
    clipIds: readonly string[];
    rippleEnabled: boolean;
};

/** Derive removal and collateral placement from the owner's current prefix. */
export function deriveRippleDelete<TClip extends Pick<Clip, 'id' | 'startBeat' | 'endBeat'>>({
    clips,
    clipIds,
    rippleEnabled,
}: RippleDeleteInput<TClip>): {
    removedClips: TClip[];
    shiftedClips: RippleDeleteShift[];
    nextClips: TClip[];
} | null {
    const clipIdSet = new Set(clipIds);
    const removedClips = clips.filter((clip) => clipIdSet.has(clip.id));
    if (removedClips.length === 0) {
        return null;
    }
    let deleteStart = Infinity;
    let deleteEnd = -Infinity;
    for (const clip of removedClips) {
        if (clip.startBeat < deleteStart) {
            deleteStart = clip.startBeat;
        }
        if (clip.endBeat > deleteEnd) {
            deleteEnd = clip.endBeat;
        }
    }
    const gap = deleteEnd - deleteStart;
    const shiftedClips: RippleDeleteShift[] = [];
    const nextClips = clips.reduce<TClip[]>((accumulator, clip) => {
        if (clipIdSet.has(clip.id)) {
            return accumulator;
        }
        if (rippleEnabled && clip.startBeat >= deleteEnd) {
            shiftedClips.push({
                clipId: clip.id,
                origStartBeat: clip.startBeat,
                origEndBeat: clip.endBeat,
                automationDelta: -gap,
            });
            accumulator.push({ ...clip, startBeat: clip.startBeat - gap, endBeat: clip.endBeat - gap });
            return accumulator;
        }
        accumulator.push(clip);
        return accumulator;
    }, []);
    return { removedClips, shiftedClips, nextClips };
}
