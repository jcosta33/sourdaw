import { addClip, addTrack, removeClip, removeTrack } from '#/modules/Arrangement/useCases';
import { audioBufferCache } from '#/modules/AudioEngine/stores';
import { pushUndoEntry } from '#/modules/Command/stores';

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
    audioBufferCache.set(audioBufferId, input.buffer);

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

    pushUndoEntry(
        'Render to clip',
        () => {
            removeClip(clip.id);
            if (createdNewTrack) {
                removeTrack(trackId);
            }
        },
        () => {
            if (createdNewTrack) {
                addTrack({ id: trackId, name: input.name, kind: 'audio' });
            }
            addClip({
                trackId,
                startBeat: input.startBeat,
                endBeat: input.endBeat,
                name: input.name,
                type: 'audio',
                audioBufferId,
            });
        }
    );

    return { trackId, clipId: clip.id, audioBufferId };
}
