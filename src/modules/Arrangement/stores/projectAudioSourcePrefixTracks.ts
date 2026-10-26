import { type Clip, type Track, sanitizeTrackSnapshot } from './trackStore';

const CLIP_NUMBER_FIELDS = [
    'startBeat',
    'endBeat',
    'fadeInBeats',
    'fadeOutBeats',
    'gain',
    'audioOffsetBeats',
    'audioOffsetSeconds',
    'audioUnwrappedOffsetSeconds',
    'audioLoopStartSeconds',
    'audioLoopPassEntrySeconds',
    'audioLoopPassOriginBeat',
    'midiOffsetBeats',
    'stretchRatio',
    'loopLength',
    'loopOriginBeat',
    'sourceKeyRoot',
] as const satisfies readonly (keyof Clip)[];

function prefixNumber(value: number): number {
    return value === 0 ? 0 : value;
}

function projectClip(clip: Clip): Clip {
    const projected = { ...clip };
    for (const field of CLIP_NUMBER_FIELDS) {
        const value = clip[field];
        if (value !== undefined) {
            projected[field] = prefixNumber(value);
        }
    }
    const knead = clip.kneadState;
    if (knead) {
        projected.kneadState = {
            ...knead,
            retuneSpeedMs: prefixNumber(knead.retuneSpeedMs),
            humanizePercent: prefixNumber(knead.humanizePercent),
            blobs: knead.blobs.map((blob) => {
                const projectedBlob = {
                    ...blob,
                    startTime: prefixNumber(blob.startTime),
                    endTime: prefixNumber(blob.endTime),
                    pitchCenterCents: prefixNumber(blob.pitchCenterCents),
                    pitchCurveCents: blob.pitchCurveCents.map(prefixNumber),
                    voicedConfidence: prefixNumber(blob.voicedConfidence),
                };
                if (blob.originalPitchCenterCents !== undefined) {
                    projectedBlob.originalPitchCenterCents = prefixNumber(blob.originalPitchCenterCents);
                }
                return projectedBlob;
            }),
        };
    }
    return projected;
}

/** The source replay consumes complete clips, including split-guard equality.
 * Keep the former JSON boundary's number representation there, and materialize
 * knead curves that the general store decoder may retain from an Automerge list.
 * Other track fields remain disposable store projections, outside source ownership. */
export function projectAudioSourcePrefixTracks(value: unknown): Track[] {
    return sanitizeTrackSnapshot(value).tracks.map((track) => ({
        ...track,
        clips: track.clips.map(projectClip),
        alternatives: track.alternatives.map((alternative) => ({
            ...alternative,
            clips: alternative.clips.map(projectClip),
        })),
    }));
}
