import {
    generateMidiAI,
    type GeneratedNote,
    isTauri,
} from '#/modules/AudioEngine/useCases/nativeAiBridge';
import { trackStore } from '#/modules/Arrangement/stores/trackStore';
import { addClip } from '#/modules/Arrangement/useCases/clip/addClip';
import { addTrack } from '#/modules/Arrangement/useCases/addTrack';
import { addMidiNote } from '#/modules/MIDI/useCases/midiNoteCrud';
import { getTransportState } from '#/modules/Transport/useCases/transportQueries';
import { workspaceStore } from '#/modules/Workspace/stores/workspaceStore';
import { generateMidiViaLlm } from '../llmMidiGeneration';
import { addTask, updateTask } from './taskManagement';

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

            // Prefer selected MIDI track → create new one if selected isn't MIDI or nothing selected
            let targetTrack = tState?.tracks.find((t) => t.id === selectedTrackId && t.kind === 'midi');
            if (!targetTrack) {
                const newTrack = addTrack({ name: prompt ? `AI: ${prompt.slice(0, 20)}` : 'AI MIDI', kind: 'midi' });
                targetTrack = newTrack ?? undefined;
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
            updateTask(taskId, {
                status: 'success',
                data: { noteCount: finalNotes.length },
                durationMs: Math.round(performance.now() - start),
            });
        } else {
            updateTask(taskId, {
                status: 'error',
                error: 'No notes generated — try rephrasing the prompt',
                durationMs: Math.round(performance.now() - start),
            });
        }
    } catch (error: unknown) {
        updateTask(taskId, { status: 'error', error: error instanceof Error ? error.message : 'Generation failed' });
    }
}
