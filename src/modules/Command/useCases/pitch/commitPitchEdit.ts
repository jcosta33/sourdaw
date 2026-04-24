import { invoke } from '@tauri-apps/api/core';

import { trackStore } from '#/modules/Arrangement/stores';
import { audioBufferCache } from '#/modules/AudioEngine/stores';
import { processPitchEditWasm } from '#/modules/AudioEngine/useCases';
import { isTauri } from '#/utils/tauriBridge';

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

export async function commitPitchEditCommand(clipId: string, segments: NoteSegment[], contour: any): Promise<void> {
    const targetClip = findAudioClip(clipId);

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
            const buffer = getCachedAudioBuffer(targetClip);
            if (!buffer) {
                throw new Error('Could not get audio buffer for clip');
            }
            processPitchEditWasm(buffer, segments, contour, outputAudioPath);
        }

        const undoFn = () => {
            const state = trackStore.value;
            if (!state) {
                return;
            }
            const newTracks = state.tracks.map((t: any) => ({
                ...t,
                clips: t.clips.map((c: any) => (c.id === clipId ? { ...c, fileId: originalFileId } : c)),
            }));
            trackStore.set({ ...state, tracks: newTracks });
        };

        const redoFn = () => {
            const state = trackStore.value;
            if (!state) {
                return;
            }
            const newTracks = state.tracks.map((t: any) => ({
                ...t,
                clips: t.clips.map((c: any) => (c.id === clipId ? { ...c, fileId: outputAudioPath } : c)),
            }));
            trackStore.set({ ...state, tracks: newTracks });
        };

        // Apply immediately
        redoFn();

        // 3. Register Undo Command
        const entry = createCallbackUndoEntry('Commit Pitch Edit', undoFn, redoFn, 'manual');
        commitUndoEntry(entry);
    } catch (error) {
        console.error('Failed to commit pitch edit:', error);
    }
}
