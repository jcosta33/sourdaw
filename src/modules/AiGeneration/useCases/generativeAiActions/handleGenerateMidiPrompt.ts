import {
    generateMidiAI,
    type GeneratedNote,
    isTauri,
} from '#/modules/AudioEngine/repositories/nativeAIBridge';
import { trackStore } from '#/modules/Track/stores/trackStore';
import { addClip } from '#/modules/Clip/useCases/clipUseCases';
import { addMidiNote } from '#/modules/Midi/useCases/midiNoteCrud';
import { getTransportState } from '#/modules/Transport/useCases/transportQueries';
import { workspaceStore } from '#/modules/Workspace/stores/workspaceStore';
import { generateMidiViaLlm } from '../llmMidiGeneration';
import { addTask, updateTask, removeTask } from './taskManagement';

export async function handleGenerateMidiPrompt(prompt: string, numNotes: number = 32, creativity: number = 0.65) {
    const taskId = addTask({ type: 'midi-generation', status: 'processing', prompt });
    try {
        const start = performance.now();
        let finalNotes: GeneratedNote[] = [];

        if (isTauri()) {
            const seedNotes: Array<[number, number, number, number]> = [
                [60, 80, 0, 0.5],
                [62, 75, 0.5, 0.5],
                [64, 85, 1.0, 0.5],
                [65, 80, 1.5, 0.5],
            ];
            const res = await generateMidiAI(seedNotes, numNotes, creativity, 40);
            finalNotes = res.notes;
        } else {
            finalNotes = await generateMidiViaLlm(prompt, numNotes, creativity);
        }

        if (finalNotes.length > 0) {
            const tState = trackStore.value;
            const selectedTrackId = tState?.selectedTrackId;
            let targetTrack = tState?.tracks.find((t) => t.id === selectedTrackId && t.kind === 'midi');
            if (!targetTrack) {
                targetTrack = tState?.tracks.find((t) => t.kind === 'midi');
            }

            if (targetTrack) {
                const transport = getTransportState();
                const startBeat = transport ? transport.playheadPosition : 0;
                const endBeat = startBeat + Math.max(...finalNotes.map((n) => n.start_beat + n.duration_beats));

                const clip = addClip({
                    trackId: targetTrack.id,
                    startBeat,
                    endBeat,
                    name: prompt ? `✨ AI: ${prompt.slice(0, 15)}` : '✨ AI Generation',
                    type: 'midi',
                });

                if (clip) {
                    for (const n of finalNotes) {
                        addMidiNote(clip.id, n.pitch, n.start_beat, n.duration_beats, n.velocity);
                    }
                    const ws = workspaceStore.value;
                    if (ws) {
                        workspaceStore.set({ ...ws, selectedClipId: clip.id });
                    }
                }
            }
            removeTask(taskId);
        } else {
            updateTask(taskId, {
                status: 'success',
                data: finalNotes,
                durationMs: Math.round(performance.now() - start),
            });
        }
    } catch (error: unknown) {
        updateTask(taskId, { status: 'error', error: error instanceof Error ? error.message : 'Generation failed' });
    }
}
