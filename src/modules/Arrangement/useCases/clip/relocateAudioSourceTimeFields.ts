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
    return {
        ...(clip.audioOffsetSeconds === undefined ? {} : { audioOffsetSeconds: clip.audioOffsetSeconds }),
        ...(clip.audioUnwrappedOffsetSeconds === undefined
            ? {}
            : { audioUnwrappedOffsetSeconds: clip.audioUnwrappedOffsetSeconds }),
        ...(clip.audioLoopStartSeconds === undefined ? {} : { audioLoopStartSeconds: clip.audioLoopStartSeconds }),
        ...(clip.audioLoopPassEntrySeconds === undefined
            ? {}
            : { audioLoopPassEntrySeconds: clip.audioLoopPassEntrySeconds }),
        ...(clip.audioLoopPassOriginBeat === undefined
            ? {}
            : { audioLoopPassOriginBeat: clip.audioLoopPassOriginBeat + placementDeltaBeats }),
    };
}
