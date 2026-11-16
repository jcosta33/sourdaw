import { type Clip, type Track, type TrackStoreState } from '#/modules/Arrangement/stores';

/** What the prompt bar reads from the tracks: the selection's names and kinds, and how many tracks exist. */
export type PromptTrackFacts = {
    selectedTrackId: string | null | undefined;
    selectedTrackName: string | undefined;
    selectedTrackKind: Track['kind'] | undefined;
    selectedClipName: string | undefined;
    selectedClipType: Clip['type'] | undefined;
    trackCount: number;
};

export const readPromptTrackFacts = (
    state: TrackStoreState | null,
    selectedClipId: string | null
): PromptTrackFacts => {
    const tracks = state?.tracks ?? [];
    const selectedTrackId = state?.selectedTrackId;
    const selectedTrack = tracks.find((track) => track.id === selectedTrackId);
    const selectedClip = tracks.flatMap((track) => track.clips).find((clip) => clip.id === selectedClipId);
    return {
        selectedTrackId,
        selectedTrackName: selectedTrack?.name,
        selectedTrackKind: selectedTrack?.kind,
        selectedClipName: selectedClip?.name,
        selectedClipType: selectedClip?.type,
        trackCount: tracks.length,
    };
};

export const isSamePromptTrackFacts = (a: PromptTrackFacts, b: PromptTrackFacts): boolean =>
    a.selectedTrackId === b.selectedTrackId &&
    a.selectedTrackName === b.selectedTrackName &&
    a.selectedTrackKind === b.selectedTrackKind &&
    a.selectedClipName === b.selectedClipName &&
    a.selectedClipType === b.selectedClipType &&
    a.trackCount === b.trackCount;
