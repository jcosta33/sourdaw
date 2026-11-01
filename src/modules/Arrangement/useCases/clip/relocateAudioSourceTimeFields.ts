import { type Clip } from '../../models/Track';

type PhysicalAudioSourceTimeFields = Pick<
    Clip,
    | 'audioOffsetSeconds'
    | 'audioUnwrappedOffsetSeconds'
    | 'audioLoopStartSeconds'
    | 'audioLoopPassEntrySeconds'
    | 'audioLoopPassOriginBeat'
>;

/** Copy the captured source clock while relocating its timeline pass anchor. */
export function relocateAudioSourceTimeFields(
    clip: Readonly<PhysicalAudioSourceTimeFields>,
    placementDeltaBeats: number
): PhysicalAudioSourceTimeFields {
    const fields: PhysicalAudioSourceTimeFields = {};
    if (clip.audioOffsetSeconds !== undefined) {
        fields.audioOffsetSeconds = clip.audioOffsetSeconds;
    }
    if (clip.audioUnwrappedOffsetSeconds !== undefined) {
        fields.audioUnwrappedOffsetSeconds = clip.audioUnwrappedOffsetSeconds;
    }
    if (clip.audioLoopStartSeconds !== undefined) {
        fields.audioLoopStartSeconds = clip.audioLoopStartSeconds;
    }
    if (clip.audioLoopPassEntrySeconds !== undefined) {
        fields.audioLoopPassEntrySeconds = clip.audioLoopPassEntrySeconds;
    }
    if (clip.audioLoopPassOriginBeat !== undefined) {
        fields.audioLoopPassOriginBeat = clip.audioLoopPassOriginBeat + placementDeltaBeats;
    }
    return fields;
}
