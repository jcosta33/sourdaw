import { invoke } from '@tauri-apps/api/core';

import { trackStore } from '#/modules/Arrangement/stores';
import { getBufferForClip } from '#/modules/Arrangement/useCases';
import { processPitchEditWasm } from '#/modules/AudioEngine/useCases';
import { isTauri } from '#/utils/tauriBridge';

import { createCallbackUndoEntry } from '../commandQueries';
import { commitUndoEntry } from '../commitUndoEntry';

type NoteSegment = {
    start_time_ms: number;
    end_time_ms: number;
    shift_semitones: number;
};

export async function commitPitchEditCommand(clipId: string, segments: NoteSegment[], contour: any): Promise<void> {
    const tracksState = trackStore.value;
    let targetClip: any = null;
    if (tracksState && tracksState.tracks) {
        for (const track of Object.values(tracksState.tracks)) {
            for (const clip of track.clips) {
                if (clip.id === clipId && clip.type === 'audio') {
                    targetClip = clip;
                    break;
                }
            }
            if (targetClip) {
                break;
            }
        }
    }

    if (!targetClip || !targetClip.fileId) {
        return;
    }

    const originalFileId = targetClip.fileId;
    const outputAudioPath = originalFileId.replace('.wav', '_pitch.wav');

    try {
        if (isTauri()) {
            // 1. Process offline via Tauri
            await invoke('commit_pitch_edit', {
                request: {
                    inputAudioPath: originalFileId,
                    outputAudioPath,
                    segments,
                    contour,
                },
            });
        } else {
            // WASM fallback
            const result = getBufferForClip(clipId);
            if (!result || !result.buffer) {
                throw new Error('Could not get audio buffer for clip');
            }
            processPitchEditWasm(result.buffer, segments, contour, outputAudioPath);
        }

        function undoFn() {
            const state = trackStore.value;
            if (!state) {
                return;
            }
            const newTracks = state.tracks.map((time: any) => ({
                ...time,
                clips: time.clips.map((context: any) => (context.id === clipId ? { ...context, fileId: originalFileId } : context)),
            }));
            trackStore.set({ ...state, tracks: newTracks });
        }

        function redoFn() {
            const state = trackStore.value;
            if (!state) {
                return;
            }
            const newTracks = state.tracks.map((time: any) => ({
                ...time,
                clips: time.clips.map((context: any) => (context.id === clipId ? { ...context, fileId: outputAudioPath } : context)),
            }));
            trackStore.set({ ...state, tracks: newTracks });
        }

        // Apply immediately
        redoFn();

        // 3. Register Undo Command
        const entry = createCallbackUndoEntry('Commit Pitch Edit', undoFn, redoFn, 'manual');
        commitUndoEntry(entry);
    } catch (error) {
        console.error('Failed to commit pitch edit:', error);
    }
}
