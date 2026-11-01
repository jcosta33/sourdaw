import { createHandler } from '#/utils/createHandler';

import { type Clip } from '../../models/Track';
import {
    captureClipAudioSource,
    type ClipAudioSourceFields,
    isSameClipAudioSource,
} from '../../useCases/clipEditing/clipAudioSourceFields';
import { restoreCrossfadeClips } from '../../useCases/clipEditing/restoreCrossfadeClips';
import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { toHandlerExecutionResult } from '../toHandlerExecutionResult';

type ReadCrossfadeSnapshotInput = {
    clipA: { endBeat: number; fadeOutBeats: number };
    clipB: Clip;
};

function readCrossfadeSnapshot({ clipA, clipB }: ReadCrossfadeSnapshotInput) {
    const snapshot: {
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
        snapshot.clipBAudioOffsetBeats = clipB.audioOffsetBeats;
    }
    if (clipB.midiOffsetBeats !== undefined) {
        snapshot.clipBMidiOffsetBeats = clipB.midiOffsetBeats;
    }
    if (clipB.loopOriginBeat !== undefined) {
        snapshot.clipBLoopOriginBeat = clipB.loopOriginBeat;
    }
    const audioSource = captureClipAudioSource(clipB);
    if (audioSource) {
        snapshot.clipBAudioSource = audioSource;
    }
    return snapshot;
}

type SnapshotsMatchInput = {
    left: ReturnType<typeof readCrossfadeSnapshot>;
    right: ReturnType<typeof readCrossfadeSnapshot>;
};

// A legacy capture names no clock; one recorded with it must find it unchanged.
function audioSourcesMatch({ left, right }: SnapshotsMatchInput) {
    return (
        right.clipBAudioSource === undefined ||
        isSameClipAudioSource(left.clipBAudioSource ?? {}, right.clipBAudioSource)
    );
}

// The anchor is deliberately absent from the comparison: a legacy expected
// snapshot carries no anchor field while the live clip may hold one a later
// edit minted, and comparing the two would refuse every legacy entry's undo.
// The anchor rides in the replacement alone (#5198).
function snapshotsMatch({ left, right }: SnapshotsMatchInput) {
    return (
        left.clipAEndBeat === right.clipAEndBeat &&
        left.clipAFadeOutBeats === right.clipAFadeOutBeats &&
        left.clipBStartBeat === right.clipBStartBeat &&
        left.clipBFadeInBeats === right.clipBFadeInBeats &&
        left.clipBAudioOffsetBeats === right.clipBAudioOffsetBeats &&
        left.clipBMidiOffsetBeats === right.clipBMidiOffsetBeats &&
        audioSourcesMatch({ left, right })
    );
}

export const handleRestoreCrossfadeClips = createHandler<'restoreCrossfadeClips'>({
    execute: (action) => {
        const clips = getTrackStoreState()?.tracks.flatMap((track) => track.clips) ?? [];
        const clipA = clips.find((clip) => clip.id === action.payload.clipAId);
        const clipB = clips.find((clip) => clip.id === action.payload.clipBId);
        if (
            !clipA ||
            !clipB ||
            clipA.locked ||
            clipB.locked ||
            !snapshotsMatch({ left: readCrossfadeSnapshot({ clipA, clipB }), right: action.payload.expected })
        ) {
            return { status: 'conflict' };
        }
        return toHandlerExecutionResult(
            restoreCrossfadeClips({
                clipAId: clipA.id,
                clipBId: clipB.id,
                replacement: action.payload.replacement,
            })
        );
    },
    describe: () => ({ label: 'Restore crossfade clips', inverseAction: null }),
    isNoop: (action) => {
        const clips = getTrackStoreState()?.tracks.flatMap((track) => track.clips) ?? [];
        const clipA = clips.find((clip) => clip.id === action.payload.clipAId);
        const clipB = clips.find((clip) => clip.id === action.payload.clipBId);
        if (!clipA || !clipB) {
            return false;
        }
        return snapshotsMatch({ left: readCrossfadeSnapshot({ clipA, clipB }), right: action.payload.replacement });
    },
    undoable: false,
});
