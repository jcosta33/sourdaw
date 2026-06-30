import { addClip, addTrack, getTrackStoreState, setTrackStoreState } from '#/modules/Arrangement/useCases';
import { generateMidiAI, type MidiGenerationNote, isTauri } from '#/modules/AudioEngine/useCases';
import { pushUndoEntry } from '#/modules/Command/useCases';
import { batchAddMidiNotes, getMidiStoreState, setMidiStoreState } from '#/modules/MIDI/useCases';
import { getTransportState } from '#/modules/Transport/useCases';
import { selectClip } from '#/modules/Workspace/useCases';

import { generateMidiViaLlm } from '../llmMidiGeneration';

import { addTask } from './addTask';
import { updateTask } from './updateTask';

/** Pitch-class offsets (semitones above the root) for the two scales we seed from. */
const MAJOR_SCALE_STEPS = [0, 2, 4, 5, 7, 9, 11] as const;
const MINOR_SCALE_STEPS = [0, 2, 3, 5, 7, 8, 10] as const;

/** Note-name → pitch class (semitones above C). Covers sharps and flats. */
const PITCH_CLASS_BY_NAME: Record<string, number> = {
    c: 0,
    'c#': 1,
    db: 1,
    d: 2,
    'd#': 3,
    eb: 3,
    e: 4,
    f: 5,
    'f#': 6,
    gb: 6,
    g: 7,
    'g#': 8,
    ab: 8,
    a: 9,
    'a#': 10,
    bb: 10,
    b: 11,
};

/**
 * Build the seed notes the native MIDI model is primed with. Rather than a
 * fixed C-major run regardless of intent, derive a 4-note ascending scale walk
 * from any musical key + mode mentioned in the prompt (e.g. "moody bass in F#
 * minor"). When the prompt names no key, fall back to a documented default: an
 * ascending C-major fragment in octave 4 — the same notes the handler used
 * before, kept so the no-key path is unchanged.
 *
 * Pure function (prompt → seed) so it can be unit-tested without the engine.
 *
 * @returns `[pitch, velocity, startBeat, durationBeats]` tuples.
 */
export function buildSeedNotesFromPrompt(prompt: string): Array<[number, number, number, number]> {
    const lower = prompt.toLowerCase();

    // Match a key token like "c", "f#", "bb" — only when followed by a mode
    // word ("major"/"minor"/"maj"/"min") so we don't grab the "c" in "chill".
    const keyMatch = /\b([a-g](?:#|b)?)\s*(?:\b)?(major|maj|minor|min)\b/.exec(lower);

    let rootPc = 0; // default root: C
    let steps: readonly number[] = MAJOR_SCALE_STEPS;

    if (keyMatch) {
        const name = keyMatch[1] ?? '';
        const mode = keyMatch[2] ?? '';
        const pc = PITCH_CLASS_BY_NAME[name];
        if (pc !== undefined) {
            rootPc = pc;
        }
        steps = mode.startsWith('min') ? MINOR_SCALE_STEPS : MAJOR_SCALE_STEPS;
    }

    const rootMidi = 60 + rootPc; // octave 4 (C4 = 60)
    const velocities = [80, 75, 85, 80];
    return [0, 1, 2, 3].map((i): [number, number, number, number] => {
        const step = steps[i % steps.length] ?? 0;
        const velocity = velocities[i] ?? 80;
        return [rootMidi + step, velocity, i * 0.5, 0.5];
    });
}

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
