import { trackStore } from '#/modules/Arrangement/stores';
import { type Track, type Clip } from '#/modules/Arrangement/stores';
import { getBufferForClip } from '#/modules/Arrangement/useCases';
import { processPitchEditWasm } from '#/modules/AudioEngine/useCases';
import { type PitchContour } from '#/modules/Knead/stores/kneadStore';
import { isTauri, tauriInvoke } from '#/utils/tauriBridge';

import { createCallbackUndoEntry } from '../commandQueries';
import { commitUndoEntry } from '../commitUndoEntry';

type NoteSegment = {
    start_time_ms: number;
    end_time_ms: number;
    shift_semitones: number;
};

export async function commitPitchEditCommand(
    clipId: string,
    segments: NoteSegment[],
    contour: PitchContour
): Promise<void> {
    const tracksState = trackStore.value;
    let targetClip: Clip | null = null;
    if (tracksState?.tracks) {
        outer: for (const track of tracksState.tracks) {
            for (const clip of track.clips) {
                if (clip.id === clipId && clip.type === 'audio') {
                    targetClip = clip;
                    break outer;
                }
            }
        }
    }

    if (!targetClip?.audioBufferId) {
        return;
    }

    const originalFileId = targetClip.audioBufferId;
    const outputAudioPath = originalFileId.replace('.wav', '_pitch.wav');

    try {
        if (isTauri()) {
            await tauriInvoke('commit_pitch_edit', {
                request: {
                    inputAudioPath: originalFileId,
                    outputAudioPath,
                    segments,
                    contour,
                },
            });
        } else {
            const result = getBufferForClip(clipId);
            if (!result || !result.buffer) {
                throw new Error('Could not get audio buffer for clip');
            }
            processPitchEditWasm(result.buffer, segments, contour, outputAudioPath);
        }

        function updateTracks(fileId: string): Track[] {
            const state = trackStore.value;
            if (!state) {
                return [];
            }
            return state.tracks.map((track) => ({
                ...track,
                clips: track.clips.map((clip) => (clip.id === clipId ? { ...clip, audioBufferId: fileId } : clip)),
            }));
        }

        function undoFn() {
            const state = trackStore.value;
            if (!state) {
                return;
            }
            trackStore.set({ ...state, tracks: updateTracks(originalFileId) });
        }

        function redoFn() {
            const state = trackStore.value;
            if (!state) {
                return;
            }
            trackStore.set({ ...state, tracks: updateTracks(outputAudioPath) });
        }

        redoFn();

        const entry = createCallbackUndoEntry('Commit Pitch Edit', undoFn, redoFn, 'manual');
        commitUndoEntry(entry);
    } catch (error) {
        console.error('Failed to commit pitch edit:', error);
    }
}
