import { trackStore } from '#/modules/Arrangement/stores';
import { addClip, addTrack } from '#/modules/Arrangement/useCases';
import { audioBufferCache } from '#/modules/AudioEngine/stores';
import { pushUndoEntry } from '#/modules/Command/useCases';

export type RenderToClipInput = {
    /** Target track id, or 'new' to create a fresh audio track. */
    targetTrackId: string | 'new';
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

    const stateBefore = trackStore.value;
    if (!stateBefore) {
        return null;
    }
    const tracksBefore = structuredClone(stateBefore.tracks);

    let trackId: string;
    if (input.targetTrackId === 'new') {
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
        return null;
    }

    const stateAfter = trackStore.value;
    const tracksAfter = structuredClone(stateAfter?.tracks ?? []);
    pushUndoEntry(
        'Render to clip',
        () => {
            const s = trackStore.value;
            if (s) {
                trackStore.set({ ...s, tracks: tracksBefore });
            }
        },
        () => {
            const s = trackStore.value;
            if (s) {
                trackStore.set({ ...s, tracks: tracksAfter });
            }
        }
    );

    return { trackId, clipId: clip.id, audioBufferId };
}
