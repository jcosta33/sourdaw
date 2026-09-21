import {
    addClip,
    addTrack,
    captureRetiredTakeLanes,
    removeClip,
    removeTrack,
    restoreTakesForClip,
} from '#/modules/Arrangement/useCases';
import { cacheAudioBuffer } from '#/modules/AudioEngine/useCases';
import { pushUndoEntry, REDO_NOT_APPLIED } from '#/modules/Command/useCases';
import { type RetiredTakeLaneSnapshot } from '#/utils/handlerContract';

export type RenderToClipInput = {
    /** Target track id, or the literal 'new' to create a fresh audio track. */
    targetTrackId: string;
    startBeat: number;
    endBeat: number;
    buffer: AudioBuffer;
    name: string;
};

export type RenderToClipOutput = {
    trackId: string;
    clipId: string;
    audioBufferId: string;
};

export function renderToClip(input: RenderToClipInput): RenderToClipOutput | null {
    const audioBufferId = `rendered-${crypto.randomUUID()}`;
    cacheAudioBuffer({ buffer: input.buffer, bufferId: audioBufferId });

    const createdNewTrack = input.targetTrackId === 'new';
    let trackId: string;
    if (createdNewTrack) {
        const created = addTrack({ name: input.name, kind: 'audio' });
        if (!created) {
            return null;
        }
        trackId = created.id;
    } else {
        trackId = input.targetTrackId;
    }

    const clip = addClip({
        trackId,
        startBeat: input.startBeat,
        endBeat: input.endBeat,
        name: input.name,
        type: 'audio',
        audioBufferId,
    });

    if (!clip) {
        if (createdNewTrack) {
            removeTrack(trackId);
        }
        return null;
    }

    // Redo re-creates the clip under the id it was rendered with, so the takes the
    // undo retires come back under the same clip identity. Only the undo knows what
    // the clip is carrying by the time it leaves, so it takes the capture.
    let retiredTakeLanes: readonly RetiredTakeLaneSnapshot[] = [];

    pushUndoEntry(
        'Render to clip',
        () => {
            retiredTakeLanes = captureRetiredTakeLanes([clip.id]);
            removeClip(clip.id);
            if (createdNewTrack) {
                removeTrack(trackId);
            }
        },
        () => {
            if (createdNewTrack) {
                addTrack({ id: trackId, name: input.name, kind: 'audio' });
            }
            const recreated = addClip({
                id: clip.id,
                trackId,
                startBeat: input.startBeat,
                endBeat: input.endBeat,
                name: input.name,
                type: 'audio',
                audioBufferId,
            });
            if (!recreated) {
                // The target track is gone, or the id is taken: nothing came back, so
                // putting the capture back would insert a lane for a track and a clip
                // that exist nowhere. The redo reports that it did not apply instead.
                return REDO_NOT_APPLIED;
            }
            restoreTakesForClip(retiredTakeLanes);
            return undefined;
        },
        // The redo closure re-creates the rendered clip with this buffer id.
        { restoresBufferIds: [audioBufferId] }
    );

    return { trackId, clipId: clip.id, audioBufferId };
}
