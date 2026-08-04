import { getTrackStoreState, selectClip } from '#/modules/Arrangement/useCases';
import { executeAppActionBatch } from '#/modules/Command/useCases';
import { captureProjectRevision } from '#/modules/CrdtDocument/useCases';
import { getNotesForClip } from '#/modules/MIDI/useCases';
import { getTransportState } from '#/modules/Transport/useCases';
import { type AppAction } from '#/utils/handlerContract';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { getAiSnapshot } from '../../stores/aiStore';
import { generateMidiViaLlm } from '../llmMidiGeneration';

import { addTask } from './addTask';
import { updateTask } from './updateTask';

type MidiGenerationNote = Awaited<ReturnType<typeof generateMidiViaLlm>>[number];

function isTaskProcessing(taskId: string): boolean {
    return getAiSnapshot().tasks.some((task) => task.id === taskId && task.status === 'processing');
}

function hasDurableGeneration(clipId: string, expectedNotes: readonly MidiGenerationNote[]): boolean {
    const state = getTrackStoreState();
    const clipExists = state?.tracks.some((track) => track.clips.some((clip) => clip.id === clipId)) ?? false;
    if (!clipExists) {
        return false;
    }

    const expected = expectedNotes
        .map(
            (note) =>
                `${String(note.pitch)}:${String(note.start_beat)}:${String(note.duration_beats)}:${String(note.velocity)}`
        )
        .sort();
    const written = getNotesForClip(clipId)
        .map(
            (note) =>
                `${String(note.pitch)}:${String(note.startBeat)}:${String(note.duration)}:${String(note.velocity)}`
        )
        .sort();
    return expected.length === written.length && expected.every((note, index) => note === written[index]);
}

function failureMessage(status: string, reason?: string): string {
    if (status === 'cancelled' || status === 'conflicted') {
        return 'MIDI generation was cancelled because the project changed while AI was working.';
    }
    if (status === 'ambiguous') {
        return 'MIDI generation may have committed, but its final state could not be verified.';
    }
    return reason ? `MIDI generation failed: ${reason}` : 'MIDI generation failed: the project rejected the write.';
}

export async function handleGenerateMidiPrompt(
    prompt: string,
    numNotes: number = 32,
    creativity: number = 0.65
): Promise<void> {
    const taskId = addTask({ type: 'midi-generation', status: 'processing', prompt });
    const start = performance.now();
    const projectRevision = captureProjectRevision();
    const initialTrackState = getTrackStoreState();
    const startBeat = getTransportState()?.playheadPosition ?? 0;

    try {
        const finalNotes = await generateMidiViaLlm(prompt, numNotes, creativity);
        if (!isTaskProcessing(taskId)) {
            return;
        }
        if (finalNotes.length === 0) {
            updateTask(taskId, {
                status: 'error',
                error: 'No notes generated — try rephrasing the prompt',
                durationMs: Math.round(performance.now() - start),
            });
            return;
        }

        const selectedTrackId = initialTrackState?.selectedTrackId;
        const selectedMidiTrack = initialTrackState?.tracks.find(
            (track) => track.id === selectedTrackId && track.kind === 'midi'
        );
        const targetTrackId = selectedMidiTrack?.id ?? `track-ai-${crypto.randomUUID()}`;
        const clipId = `clip-ai-${crypto.randomUUID()}`;

        let maxNoteBeat = 0;
        for (const note of finalNotes) {
            const noteEnd = note.start_beat + note.duration_beats;
            if (noteEnd > maxNoteBeat) {
                maxNoteBeat = noteEnd;
            }
        }

        const actions: AppAction[] = [];
        if (!selectedMidiTrack) {
            actions.push({
                type: 'addTrack',
                payload: {
                    id: targetTrackId,
                    name: prompt ? `AI: ${prompt.slice(0, 20)}` : 'AI MIDI',
                    kind: 'midi',
                },
            });
        }
        actions.push(
            {
                type: 'addClip',
                payload: {
                    id: clipId,
                    trackId: targetTrackId,
                    startBeat,
                    endBeat: startBeat + maxNoteBeat,
                    name: prompt ? `✨ AI: ${prompt.slice(0, 15)}` : '✨ AI Generation',
                    type: 'midi',
                },
            },
            {
                type: 'addNotes',
                payload: {
                    clipId,
                    notes: finalNotes.map((note) => ({
                        pitch: note.pitch,
                        startBeat: note.start_beat,
                        duration: note.duration_beats,
                        velocity: note.velocity,
                    })),
                },
            }
        );

        const result = await executeAppActionBatch(actions, {
            source: 'ai',
            groupId: `ai-midi-${taskId}`,
            groupLabel: `AI MIDI: ${prompt ? prompt.slice(0, 30) : 'Generation'}`,
            requireCompensation: true,
            skipMacroRecording: true,
            shouldExecute: () => isTaskProcessing(taskId) && captureProjectRevision() === projectRevision,
        });

        const committed = result.status === 'committed' || result.status === 'committed-with-warning';
        const durablyCommitted = result.status === 'ambiguous' && hasDurableGeneration(clipId, finalNotes);
        if (committed || durablyCommitted) {
            let warning: string | undefined;
            if (result.status === 'committed-with-warning') {
                warning = result.warning;
            } else if (result.status === 'ambiguous') {
                warning = result.reason;
            }
            if (warning) {
                notifyUser(`MIDI generation committed with a warning: ${warning}`, 'warning');
            }
            selectClip(clipId);
            updateTask(taskId, {
                status: 'success',
                data: {
                    noteCount: finalNotes.length,
                    warning,
                },
                durationMs: Math.round(performance.now() - start),
            });
            return;
        }

        if (!isTaskProcessing(taskId)) {
            return;
        }
        updateTask(taskId, {
            status: 'error',
            error: failureMessage(result.status, 'reason' in result ? result.reason : undefined),
            durationMs: Math.round(performance.now() - start),
        });
    } catch (error: unknown) {
        if (!isTaskProcessing(taskId)) {
            return;
        }
        updateTask(taskId, {
            status: 'error',
            error: error instanceof Error ? error.message : 'Generation failed',
            durationMs: Math.round(performance.now() - start),
        });
    }
}
