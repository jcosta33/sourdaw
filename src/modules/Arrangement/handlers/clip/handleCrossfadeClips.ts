import { createHandler } from '#/utils/createHandler';

import { type Clip } from '../../models/Track';
import { captureClipAudioSource, type ClipAudioSourceFields } from '../../useCases/clipEditing/clipAudioSourceFields';
import { consumedStretchFactor } from '../../useCases/clipEditing/consumedStretchFactor';
import {
    crossfadeClipBLoopOriginEntry,
    crossfadeClips,
    DEFAULT_CROSSFADE_BEATS,
    resolveCrossfadeClipB,
} from '../../useCases/clipEditing/crossfadeClips';
import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { liveTempoTimeline } from '../../useCases/liveTempoTimeline';
import { toHandlerExecutionResult } from '../toHandlerExecutionResult';

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

    const stretchFactor = consumedStretchFactor(clipB);
    // The forward leg's own plan, so redo replays exactly what it writes.
    const clipBPlan = resolveCrossfadeClipB(clipB, halfDuration, liveTempoTimeline);
    if (!clipBPlan) {
        return null;
    }
    const clipBStartBeat = clipBPlan.startBeat;
    const newClipBAudioSource = clipBPlan.audioSource;
    const overlap = clipAEndBeat - clipBStartBeat;
    const clipBDelta = clipBStartBeat - clipB.startBeat;
    const contentDelta = clipBDelta * stretchFactor;
    let newClipBAudioOffsetBeats: number | undefined;
    if (clipB.audioOffsetBeats !== undefined) {
        newClipBAudioOffsetBeats = Math.max(Math.min(0, clipB.audioOffsetBeats), clipB.audioOffsetBeats + contentDelta);
    }
    let newClipBMidiOffsetBeats: number | undefined;
    if (clipB.midiOffsetBeats !== undefined) {
        newClipBMidiOffsetBeats = Math.max(0, clipB.midiOffsetBeats + clipBDelta);
    }

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
        clipBLoopOriginBeat?: number;
        clipBAudioSource?: ClipAudioSourceFields;
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
    if (clipB.loopOriginBeat !== undefined) {
        previous.clipBLoopOriginBeat = clipB.loopOriginBeat;
    }
    const previousAudioSource = captureClipAudioSource(clipB);
    if (previousAudioSource) {
        previous.clipBAudioSource = previousAudioSource;
    }

    const next: {
        clipAEndBeat: number;
        clipAFadeOutBeats: number;
        clipBStartBeat: number;
        clipBFadeInBeats: number;
        clipBAudioOffsetBeats?: number;
        clipBMidiOffsetBeats?: number;
        clipBLoopOriginBeat?: number;
        clipBAudioSource?: ClipAudioSourceFields;
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
    if (newClipBAudioSource) {
        next.clipBAudioSource = newClipBAudioSource;
    }
    if (clipB.loopOriginBeat !== undefined) {
        // The forward leg shifts a beat-only audio clip B's anchor by
        // `clipBDelta - contentDelta` and leaves a MIDI or canonical clip B's
        // untouched; the redo snapshot records the same result so both legs
        // restore the anchor their side of the crossfade held (#5198).
        const shifted = crossfadeClipBLoopOriginEntry(clipB, clipBDelta, contentDelta);
        next.clipBLoopOriginBeat = 'loopOriginBeat' in shifted ? shifted.loopOriginBeat : clipB.loopOriginBeat;
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
        const durationBeats = action.payload.durationBeats ?? DEFAULT_CROSSFADE_BEATS;
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
