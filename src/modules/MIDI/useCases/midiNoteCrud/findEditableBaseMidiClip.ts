import { takeLaneStore, trackStore } from '#/modules/Arrangement/stores';

function clipCannotBeEdited(clip: NonNullable<typeof trackStore.value>['tracks'][number]['clips'][number]): boolean {
    return (
        clip.type !== 'midi' ||
        !!clip.locked ||
        !!clip.loopEnabled ||
        !!clip.isLinkedInstance ||
        clip.parentClipId !== undefined
    );
}

export function findEditableBaseMidiClip(clipId: string, trackId: string) {
    const tracks = trackStore.value?.tracks ?? [];
    const clips = tracks.flatMap((track) => track.clips.map((clip) => ({ track, clip })));
    const matches = clips.filter(({ clip }) => clip.id === clipId);
    const target = matches[0];
    if (
        tracks.filter((track) => track.id === trackId).length !== 1 ||
        matches.length !== 1 ||
        !target ||
        target.track.id !== trackId ||
        target.track.kind !== 'midi' ||
        target.track.frozen ||
        clipCannotBeEdited(target.clip) ||
        clips.some(({ clip }) => clip.parentClipId === clipId) ||
        takeLaneStore.value?.lanes.some(
            (lane) =>
                lane.trackId === trackId &&
                lane.takes.some(
                    (take) =>
                        take.clipId === clipId ||
                        (take.midiSource !== undefined &&
                            take.startBeat < target.clip.endBeat &&
                            take.endBeat > target.clip.startBeat)
                )
        )
    ) {
        return null;
    }
    return target.clip;
}
