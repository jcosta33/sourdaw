import {
    addClip,
    addTrack,
    captureRetiredTakeLanes,
    removeClip,
    removeTrack,
    resolveBouncedClipEndBeat,
    restoreTakesForClip,
} from '#/modules/Arrangement/useCases';
import { cacheAudioBuffer } from '#/modules/AudioEngine/useCases';
import { pushUndoEntry, REDO_NOT_APPLIED } from '#/modules/Command/useCases';
import { readBeatAtSamples, readSecondsAtBeat } from '#/modules/Transport/stores';
import { type RetiredTakeLaneSnapshot } from '#/utils/handlerContract';

export type RenderToClipInput = {
    /** Target track id, or the literal 'new' to create a fresh audio track. */
    targetTrackId: string;
    startBeat: number;
    /** Musical end of the rendered selection, before any tail. */
    endBeat: number;
    /** Seconds of tail the render carried past the selection; 0 when it rendered none. */
    tailSeconds: number;
    buffer: AudioBuffer;
    name: string;
};

export type RenderToClipOutput = {
    trackId: string;
    clipId: string;
    audioBufferId: string;
};

// A render that carried a tail holds audio past the selection, so the clip spans
// the buffer's own duration through the tempo map. A render with none holds the
// selection exactly, but its frame count is rounded up to a whole sample, so
// reading the end back from the buffer would land a hair past the musical end
// and put duplicates off the grid.
function resolveClipEndBeat(input: RenderToClipInput): number {
    if (input.tailSeconds <= 0) {
        return input.endBeat;
    }
    return resolveBouncedClipEndBeat({
        startBeat: input.startBeat,
        musicalEndBeat: input.endBeat,
        renderedBuffer: input.buffer,
        timelineSecondsAtBeat: (beat) => readSecondsAtBeat({ beat }),
        projectSampleToBeat: readBeatAtSamples,
    });
}

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

    const endBeat = resolveClipEndBeat(input);

    const clip = addClip({
        trackId,
        startBeat: input.startBeat,
        endBeat,
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
                endBeat,
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
