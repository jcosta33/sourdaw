import { applyDuplicatedTrackFields } from '../models/DuplicatedTrackFields';
import { createTrack, type Track } from '../models/Track';
import { getAlternativeClips } from '../models/TrackAlternativeClips';

export function createPlannedTrack(input: {
    id: string;
    name: string;
    kind: 'audio' | 'midi' | 'bus' | 'folder';
    gain: number;
    color: string;
    initialAlternativeId: string;
    initialDeviceId?: string;
    parentId?: string;
    outputId?: string;
    withoutDefaultDevice?: boolean;
}): Track {
    return createTrack(input);
}

/**
 * The copy `duplicateTrack` executes: a new track of the source's kind that takes only the fields
 * duplicateTrack copies. Execution mints fresh device, alternative and clip ids; the plan derives
 * distinct ids from the copy's id so no row is planned on two tracks.
 */
export function createPlannedDuplicate(source: Track, trackId: string): Track {
    const alternatives = source.alternatives.map((alternative, alternativeIndex) => ({
        ...structuredClone(alternative),
        id: `planned-dup-alt-${trackId}-${alternativeIndex}`,
        clips: structuredClone(getAlternativeClips(source, alternative)).map((clip, clipIndex) => ({
            ...clip,
            id: `planned-dup-clip-${trackId}-${alternativeIndex}-${clipIndex}`,
            trackId,
        })),
    }));
    const activeIndex = source.alternatives.findIndex((alternative) => alternative.id === source.activeAlternativeId);
    return applyDuplicatedTrackFields(
        createPlannedTrack({
            id: trackId,
            name: `${source.name} (copy)`,
            kind: source.kind === 'master' ? 'audio' : source.kind,
            gain: 0.8,
            color: source.color,
            initialAlternativeId: alternatives[0]?.id ?? `planned-dup-alt-${trackId}-0`,
        }),
        source,
        {
            devices: structuredClone(source.devices).map((device, deviceIndex) => ({
                ...device,
                id: `planned-dup-dev-${trackId}-${deviceIndex}`,
            })),
            alternatives,
            activeAlternativeId: alternatives[activeIndex]?.id ?? alternatives[0]?.id ?? '',
        }
    );
}
