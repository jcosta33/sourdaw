import { inject } from '#/infra/di/inject';
import { generateMidiAI, type MidiGenerationNote, isTauri } from '#/modules/AudioEngine';
import { addClip, addTrack, trackStore } from '#/modules/Arrangement';
import { batchAddMidiNotes, midiStore } from '#/modules/MIDI';
import { createCallbackUndoEntry, pushUndo } from '#/modules/Command';
import { getTransportState } from '#/modules/Transport';
import { workspaceStore } from '#/modules/Workspace';
import { generateMidiViaLlm } from '../llmMidiGeneration';
import { addTask } from './addTask';
import { updateTask } from './updateTask';

export const handleGenerateMidiPrompt = inject({
    generateMidiAI,
    isTauri,
    addTrack,
    addClip,
    batchAddMidiNotes,
    getTransportState,
    createCallbackUndoEntry,
    generateMidiViaLlm,
    addTask,
    updateTask,
})(
    ({
        generateMidiAI,
        isTauri,
        addTrack,
        addClip,
        batchAddMidiNotes,
        getTransportState,
        createCallbackUndoEntry,
        generateMidiViaLlm,
        addTask,
        updateTask,
    }) =>
        async function handleGenerateMidiPrompt(prompt: string, numNotes: number = 32, creativity: number = 0.65) {
            const taskId = addTask({ type: 'midi-generation', status: 'processing', prompt });
            try {
                const start = performance.now();
                let finalNotes: MidiGenerationNote[] = [];

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
                    // Snapshot state before for undo support
                    const trackSnapshotBefore = structuredClone(trackStore.value);
                    const midiSnapshotBefore = structuredClone(midiStore.value);

                    const tState = trackStore.value;
                    const selectedTrackId = tState?.selectedTrackId;

                    // Prefer selected MIDI track → create new one if selected isn't MIDI or nothing selected
                    let targetTrack = tState?.tracks.find((t) => t.id === selectedTrackId && t.kind === 'midi');
                    if (!targetTrack) {
                        const newTrack = addTrack({
                            name: prompt ? `AI: ${prompt.slice(0, 20)}` : 'AI MIDI',
                            kind: 'midi',
                        });
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
                            // Batch-insert all notes in a single store mutation (avoids O(N) CRDT flood)
                            batchAddMidiNotes(
                                clip.id,
                                finalNotes.map((n) => ({
                                    pitch: n.pitch,
                                    startBeat: n.start_beat,
                                    duration: n.duration_beats,
                                    velocity: n.velocity,
                                }))
                            );

                            // Register undo entry for the entire generation
                            const trackSnapshotAfter = structuredClone(trackStore.value);
                            const midiSnapshotAfter = structuredClone(midiStore.value);

                            const undoEntry = createCallbackUndoEntry(
                                `AI MIDI: ${prompt ? prompt.slice(0, 30) : 'Generation'}`,
                                () => {
                                    if (trackSnapshotBefore) {
                                        trackStore.set(trackSnapshotBefore);
                                    }
                                    if (midiSnapshotBefore) {
                                        midiStore.set(midiSnapshotBefore);
                                    }
                                },
                                () => {
                                    if (trackSnapshotAfter) {
                                        trackStore.set(trackSnapshotAfter);
                                    }
                                    if (midiSnapshotAfter) {
                                        midiStore.set(midiSnapshotAfter);
                                    }
                                },
                                'ai'
                            );
                            pushUndo(undoEntry);

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
                updateTask(taskId, {
                    status: 'error',
                    error: error instanceof Error ? error.message : 'Generation failed',
                });
            }
        }
);
