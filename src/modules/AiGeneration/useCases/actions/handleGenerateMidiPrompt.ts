import { addClip, addTrack, getTrackStoreState, setTrackStoreState } from '#/modules/Arrangement/useCases';
import { generateMidiAI, type MidiGenerationNote, isTauri } from '#/modules/AudioEngine/useCases';
import { pushUndoEntry } from '#/modules/Command/useCases';
import { batchAddMidiNotes, getMidiStoreState, setMidiStoreState } from '#/modules/MIDI/useCases';
import { getTransportState } from '#/modules/Transport/useCases';
import { selectClip } from '#/modules/Workspace/useCases';

import { generateMidiViaLlm } from '../llmMidiGeneration';

import { addTask } from './addTask';
import { buildSeedNotesFromPrompt } from './buildSeedNotesFromPrompt';
import { updateTask } from './updateTask';

export async function handleGenerateMidiPrompt(prompt: string, numNotes: number = 32, creativity: number = 0.65) {
    const taskId = addTask({ type: 'midi-generation', status: 'processing', prompt });
    const start = performance.now();
    try {
        let finalNotes: MidiGenerationNote[] = [];

        if (isTauri()) {
            const seedNotes = buildSeedNotesFromPrompt(prompt);
            const res = await generateMidiAI(seedNotes, numNotes, creativity, 40);
            finalNotes = res.notes;
        } else {
            finalNotes = await generateMidiViaLlm(prompt, numNotes, creativity);
        }

        if (finalNotes.length > 0) {
            // Snapshot state before for undo support. §77.1 — stores are
            // immutable-via-set so capturing the reference is equivalent
            // to structuredClone without the deep-copy jank.
            const trackSnapshotBefore = getTrackStoreState();
            const midiSnapshotBefore = getMidiStoreState();

            const tState = trackSnapshotBefore;
            const selectedTrackId = tState?.selectedTrackId;

            // Prefer selected MIDI track → create new one if selected isn't MIDI or nothing selected
            let targetTrack = tState?.tracks.find((time) => time.id === selectedTrackId && time.kind === 'midi');
            let createdNewTrack = false;
            if (!targetTrack) {
                const newTrack = addTrack({
                    name: prompt ? `AI: ${prompt.slice(0, 20)}` : 'AI MIDI',
                    kind: 'midi',
                });
                targetTrack = newTrack ?? undefined;
                createdNewTrack = newTrack !== null;
            }

            let clipCreated = false;
            if (targetTrack) {
                const transport = getTransportState();
                const startBeat = transport ? transport.playheadPosition : 0;
                let maxNoteBeat = 0;
                for (const node of finalNotes) {
                    const value = node.start_beat + node.duration_beats;
                    if (value > maxNoteBeat) {
                        maxNoteBeat = value;
                    }
                }
                const endBeat = startBeat + maxNoteBeat;

                const clip = addClip({
                    trackId: targetTrack.id,
                    startBeat,
                    endBeat,
                    name: prompt ? `✨ AI: ${prompt.slice(0, 15)}` : '✨ AI Generation',
                    type: 'midi',
                });

                if (clip) {
                    clipCreated = true;
                    // Batch-insert all notes in a single store mutation (avoids O(N) CRDT flood)
                    batchAddMidiNotes(
                        clip.id,
                        finalNotes.map((node) => ({
                            pitch: node.pitch,
                            startBeat: node.start_beat,
                            duration: node.duration_beats,
                            velocity: node.velocity,
                        }))
                    );

                    // Register undo entry for the entire generation
                    const trackSnapshotAfter = getTrackStoreState();
                    const midiSnapshotAfter = getMidiStoreState();

                    pushUndoEntry(
                        `AI MIDI: ${prompt ? prompt.slice(0, 30) : 'Generation'}`,
                        () => {
                            if (trackSnapshotBefore) {
                                setTrackStoreState(trackSnapshotBefore);
                            }
                            if (midiSnapshotBefore) {
                                setMidiStoreState(midiSnapshotBefore);
                            }
                        },
                        () => {
                            if (trackSnapshotAfter) {
                                setTrackStoreState(trackSnapshotAfter);
                            }
                            if (midiSnapshotAfter) {
                                setMidiStoreState(midiSnapshotAfter);
                            }
                        },
                        { source: 'ai' }
                    );

                    selectClip(clip.id);
                } else if (createdNewTrack) {
                    // addClip failed but we already created a track for this
                    // generation. Register an undo entry so the orphan track can
                    // be rolled back (the before-snapshot predates the track),
                    // mirroring the success path's undo. Without this the empty
                    // track is stranded with no way to undo it.
                    const trackSnapshotAfter = getTrackStoreState();
                    const midiSnapshotAfter = getMidiStoreState();
                    pushUndoEntry(
                        `AI MIDI: ${prompt ? prompt.slice(0, 30) : 'Generation'} (no clip)`,
                        () => {
                            if (trackSnapshotBefore) {
                                setTrackStoreState(trackSnapshotBefore);
                            }
                            if (midiSnapshotBefore) {
                                setMidiStoreState(midiSnapshotBefore);
                            }
                        },
                        () => {
                            if (trackSnapshotAfter) {
                                setTrackStoreState(trackSnapshotAfter);
                            }
                            if (midiSnapshotAfter) {
                                setMidiStoreState(midiSnapshotAfter);
                            }
                        },
                        { source: 'ai' }
                    );
                }
            }

            if (clipCreated) {
                updateTask(taskId, {
                    status: 'success',
                    data: { noteCount: finalNotes.length },
                    durationMs: Math.round(performance.now() - start),
                });
            } else {
                updateTask(taskId, {
                    status: 'error',
                    error: 'MIDI generation failed: could not create a clip for the notes',
                    durationMs: Math.round(performance.now() - start),
                });
            }
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
            durationMs: Math.round(performance.now() - start),
        });
    }
}
