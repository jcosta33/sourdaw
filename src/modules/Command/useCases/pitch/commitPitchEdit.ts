import { trackStore, type Track } from '#/modules/Arrangement/stores';
import { audioBufferCache } from '#/modules/AudioEngine/stores';
import { processPitchEditWasm } from '#/modules/AudioEngine/useCases';
import { type PitchContour } from '#/modules/Knead/stores/kneadStore';
import { notifyUser } from '#/utils/Notification/notifyUser';
import { isTauri, tauriInvoke } from '#/utils/tauriBridge';

import { createCallbackUndoEntry } from '../commandQueries';
import { commitUndoEntry } from '../commitUndoEntry';

type NoteSegment = {
    start_time_ms: number;
    end_time_ms: number;
    shift_semitones: number;
};

type PitchEditClip = {
    id: string;
    type: 'audio';
    fileId?: string;
    audioBufferId?: string;
};

function findAudioClip(clipId: string): PitchEditClip | null {
    const tracks = trackStore.value?.tracks ?? [];
    for (const track of tracks) {
        for (const clip of track.clips) {
            const candidate: {
                id: string;
                type: 'audio' | 'midi';
                fileId?: string;
                audioBufferId?: string;
            } = clip;
            if (candidate.id === clipId && candidate.type === 'audio') {
                return {
                    id: candidate.id,
                    type: 'audio',
                    fileId: candidate.fileId,
                    audioBufferId: candidate.audioBufferId,
                };
            }
        }
    }
    return null;
}

function getCachedAudioBuffer(clip: PitchEditClip): AudioBuffer | null {
    if (!clip.audioBufferId) {
        return null;
    }
    return audioBufferCache.get(clip.audioBufferId) ?? null;
}

export async function commitPitchEditCommand(
    clipId: string,
    segments: NoteSegment[],
    contour: PitchContour
): Promise<void> {
    const targetClip = findAudioClip(clipId);

    if (!targetClip?.fileId) {
        return;
    }

    const originalFileId = targetClip.fileId;
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
            // WASM fallback
            const buffer = getCachedAudioBuffer(targetClip);
            if (!buffer) {
                throw new Error('Could not get audio buffer for clip');
            }
            processPitchEditWasm(buffer, segments, contour, outputAudioPath);
        }

        function updateTracks(fileId: string): Track[] {
            const state = trackStore.value;
            if (!state) {
                return [];
            }
            return state.tracks.map((track) => ({
                ...track,
                clips: track.clips.map((clip) => (clip.id === clipId ? { ...clip, fileId } : clip)),
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
        // Previously the failure was swallowed into `console.error` only, so a
        // failed pitch commit looked like success to the user (no edit applied,
        // no feedback). Surface it. (Full migration of this command onto an
        // AppAction/handler + the project `logger` facade is tracked as a
        // follow-up; the `console.error` is retained here only because its
        // existing regression test asserts it.)
        console.error('Failed to commit pitch edit:', error);
        notifyUser('Failed to commit pitch edit', 'error');
    }
}
