import { createHandler } from '#/utils/createHandler';

import { type Clip } from '../../models/Track';
import { consumedStretchFactor } from '../../useCases/clipEditing/consumedStretchFactor';
import { crossfadeClips } from '../../useCases/clipEditing/crossfadeClips';
import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { toHandlerExecutionResult } from '../toHandlerExecutionResult';

function computeMaxTimelinePreRoll(clipB: Clip): { stretchFactor: number; maxTimelinePreRoll: number } {
    const stretchFactor = consumedStretchFactor(clipB);
    if (clipB.type === 'midi') {
        return { stretchFactor, maxTimelinePreRoll: Math.max(0, clipB.midiOffsetBeats ?? 0) };
    }
    return {
        stretchFactor,
        maxTimelinePreRoll: Math.max(0, clipB.audioOffsetBeats ?? 0) / stretchFactor,
    };
}

function isValidCrossfadeGeometry(
    clipAEndBeat: number,
    clipBStartBeat: number,
    overlap: number,
    newClipBAudioOffsetBeats?: number,
    newClipBMidiOffsetBeats?: number
): boolean {
    if (
        !Number.isFinite(clipAEndBeat) ||
        !Number.isFinite(clipBStartBeat) ||
        !Number.isFinite(overlap) ||
        overlap < 0
    ) {
        return false;
    }
    if (newClipBAudioOffsetBeats !== undefined && !Number.isFinite(newClipBAudioOffsetBeats)) {
        return false;
    }
    if (newClipBMidiOffsetBeats !== undefined && !Number.isFinite(newClipBMidiOffsetBeats)) {
        return false;
    }
    return true;
}

function computeCrossfadeSnapshots(clipA: Clip, clipB: Clip, durationBeats: number) {
    const halfDuration = durationBeats / 2;
    const clipAEndBeat = clipA.endBeat + halfDuration;

    const { stretchFactor, maxTimelinePreRoll } = computeMaxTimelinePreRoll(clipB);
    const unclampedClipBStart = clipB.startBeat - halfDuration;
    const boundedClipBStart = Math.max(0, clipB.startBeat - maxTimelinePreRoll);
    const clipBStartBeat = Math.max(unclampedClipBStart, boundedClipBStart);
    const overlap = clipAEndBeat - clipBStartBeat;
    const clipBDelta = clipBStartBeat - clipB.startBeat;
    const contentDelta = clipBDelta * stretchFactor;
    const newClipBAudioOffsetBeats =
        clipB.audioOffsetBeats !== undefined ? Math.max(0, clipB.audioOffsetBeats + contentDelta) : undefined;
    const newClipBMidiOffsetBeats =
        clipB.midiOffsetBeats !== undefined ? Math.max(0, clipB.midiOffsetBeats + clipBDelta) : undefined;

    if (
        !isValidCrossfadeGeometry(
            clipAEndBeat,
            clipBStartBeat,
            overlap,
            newClipBAudioOffsetBeats,
            newClipBMidiOffsetBeats
        )
    ) {
        return null;
    }

    const previous: {
        clipAEndBeat: number;
        clipAFadeOutBeats: number;
        clipBStartBeat: number;
        clipBFadeInBeats: number;
        clipBAudioOffsetBeats?: number;
        clipBMidiOffsetBeats?: number;
    } = {
        clipAEndBeat: clipA.endBeat,
        clipAFadeOutBeats: clipA.fadeOutBeats,
        clipBStartBeat: clipB.startBeat,
        clipBFadeInBeats: clipB.fadeInBeats,
    };
    if (clipB.audioOffsetBeats !== undefined) {
        previous.clipBAudioOffsetBeats = clipB.audioOffsetBeats;
    }
    if (clipB.midiOffsetBeats !== undefined) {
        previous.clipBMidiOffsetBeats = clipB.midiOffsetBeats;
    }

    const next: {
        clipAEndBeat: number;
        clipAFadeOutBeats: number;
        clipBStartBeat: number;
        clipBFadeInBeats: number;
        clipBAudioOffsetBeats?: number;
        clipBMidiOffsetBeats?: number;
    } = {
        clipAEndBeat,
        clipAFadeOutBeats: overlap,
        clipBStartBeat,
        clipBFadeInBeats: overlap,
    };
    if (newClipBAudioOffsetBeats !== undefined) {
        next.clipBAudioOffsetBeats = newClipBAudioOffsetBeats;
    }
    if (newClipBMidiOffsetBeats !== undefined) {
        next.clipBMidiOffsetBeats = newClipBMidiOffsetBeats;
    }

    return { previous, next };
}

export const handleCrossfadeClips = createHandler<'crossfadeClips'>({
    execute: (alpha) => {
        return toHandlerExecutionResult(
            crossfadeClips(alpha.payload.clipAId, alpha.payload.clipBId, alpha.payload.durationBeats)
        );
    },
    describe: (action) => {
        const clips = getTrackStoreState()?.tracks.flatMap((track) => track.clips) ?? [];
        const clipA = clips.find((clip) => clip.id === action.payload.clipAId);
        const clipB = clips.find((clip) => clip.id === action.payload.clipBId);
        const durationBeats = action.payload.durationBeats ?? 0.5;
        if (!clipA || !clipB || clipA.id === clipB.id || !Number.isFinite(durationBeats) || durationBeats < 0) {
            return { label: 'Crossfade clips', inverseAction: null };
        }
        const snapshots = computeCrossfadeSnapshots(clipA, clipB, durationBeats);
        if (!snapshots) {
            return { label: 'Crossfade clips', inverseAction: null };
        }
        return {
            label: 'Crossfade clips',
            inverseAction: {
                type: 'restoreCrossfadeClips',
                payload: {
                    clipAId: clipA.id,
                    clipBId: clipB.id,
                    expected: snapshots.next,
                    replacement: snapshots.previous,
                },
            },
            redoAction: {
                type: 'restoreCrossfadeClips',
                payload: {
                    clipAId: clipA.id,
                    clipBId: clipB.id,
                    expected: snapshots.previous,
                    replacement: snapshots.next,
                },
            },
        };
    },
    undoable: true,
});
