/**
 * Handlers for AI-powered MIDI generation and direct note writing.
 *
 * - addNotes: LLM writes MIDI notes directly to a clip
 * - completeMidi: LLM continues a MIDI phrase
 * - variationMidi: LLM creates a variation of existing notes
 * - generateBassline: LLM generates a bassline from chord/melody context
 * - detectTempo: DSP-based tempo detection (onset detection)
 * - detectKey: DSP-based key detection (chromagram)
 * - stripSilence: Remove silent sections based on amplitude threshold
 */

import { type ActionHandler, type AppAction } from '#/modules/Command/useCases/commandQueries';
import { addMidiNote, getNotesForClip, setNotesForClip } from '#/modules/MIDI/useCases/midiNoteCrud';
import { createMidiNote } from '#/modules/Arrangement/useCases/trackQueries';
import { addTrack } from '#/modules/Arrangement/useCases/addTrack';
import { addClip } from '#/modules/Arrangement/useCases/clip/addClip';
import { stripSilence } from '#/modules/Arrangement/useCases/stripSilence';
import { detectTempo, detectKey, audioToMidi } from '#/modules/Arrangement/useCases/audioAnalysis';
import { audioBufferCache } from '#/modules/AudioEngine/stores/audioBufferCache';
import { trackStore } from '#/modules/Arrangement/stores/trackStore';
import { generateToolCalls } from '#/modules/AiRuntime/useCases/llmOrchestration';
import { Container } from '#/helpers/DependencyInjector/Container';
import { Logger } from '#/helpers/Logger/Logger';

const logger = Container.getInstance().get(Logger);

type Extract<A extends AppAction, T extends string> = A extends { type: T } ? A : never;

function notePitchToName(pitch: number): string {
    const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    const octave = Math.floor(pitch / 12) - 1;
    return `${names[pitch % 12]}${String(octave)}`;
}

function formatNotesForLlm(
    notes: Array<{ pitch: number; startBeat: number; duration: number; velocity: number }>
): string {
    if (notes.length === 0) {
        return '(empty clip — no notes)';
    }
    const sorted = [...notes].sort((a, b) => a.startBeat - b.startBeat);
    return sorted
        .map(
            (n) =>
                `${notePitchToName(n.pitch)}(${String(n.startBeat)}-${String(n.startBeat + n.duration)},v${String(n.velocity)})`
        )
        .join(' ');
}

async function llmGenerateNotes(
    instruction: string,
    existingNotes: Array<{ pitch: number; startBeat: number; duration: number; velocity: number }>,
    clipId: string
): Promise<Array<{ pitch: number; startBeat: number; duration: number; velocity?: number }>> {
    const noteContext = formatNotesForLlm(existingNotes);

    const systemPrompt = `You are a MIDI composition assistant. Output ONLY a single tool call using addNotes to write MIDI notes.

Use the addNotes tool:
addNotes(clipId:string, notes:array) - Write MIDI notes to a clip

Notes format: [{pitch:number, startBeat:number, duration:number, velocity:number}]
MIDI pitch: 60=C4, 62=D4, 64=E4, 65=F4, 67=G4, 69=A4, 71=B4
Duration: 0.25=16th, 0.5=8th, 1=quarter, 2=half, 4=whole

For each function call return a json object with function name and arguments within <tool_call></tool_call> XML tags.`;

    const userMessage = `${instruction}

Existing notes in clip "${clipId}":
${noteContext}

Generate the MIDI notes now. Output ONLY the tool call.`;

    const results = await generateToolCalls(systemPrompt, userMessage);
    const addNotesCall = results.find((r) => r.name === 'addNotes');
    if (addNotesCall && Array.isArray(addNotesCall.arguments.notes)) {
        return addNotesCall.arguments.notes as Array<{
            pitch: number;
            startBeat: number;
            duration: number;
            velocity?: number;
        }>;
    }

    return [];
}

export const aiMidiHandlers = {
    addNotes: {
        execute: (a) => {
            const notes = a.payload.notes;
            if (!Array.isArray(notes) || notes.length === 0) {
                return;
            }
            for (const note of notes) {
                const pitch = Math.max(0, Math.min(127, Math.round(note.pitch)));
                const start = Math.max(0, note.startBeat);
                const dur = Math.max(0.0625, note.duration);
                const vel = Math.max(1, Math.min(127, note.velocity ?? 100));
                addMidiNote(a.payload.clipId, pitch, start, dur, vel);
            }
            logger.info(`[AI MIDI] Added ${String(notes.length)} notes to clip ${a.payload.clipId}`);
        },
        describe: (a) => ({ label: `Add ${String(a.payload.notes.length)} MIDI notes` }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'addNotes'>>,

    completeMidi: {
        execute: async (a) => {
            const existing = getNotesForClip(a.payload.clipId);
            const bars = a.payload.bars ?? 4;
            const direction = a.payload.direction ?? 'forward';

            const maxBeat = existing.length > 0 ? Math.max(...existing.map((n) => n.startBeat + n.duration)) : 0;

            const instruction =
                direction === 'forward'
                    ? `Continue this melody/pattern for ${String(bars)} more bars (${String(bars * 4)} beats), starting from beat ${String(maxBeat)}. Match the style, rhythm, and key of the existing notes.`
                    : `Write ${String(bars)} bars of content BEFORE beat 0 as a lead-in/intro, matching the style.`;

            const notes = await llmGenerateNotes(instruction, existing, a.payload.clipId);
            for (const note of notes) {
                addMidiNote(a.payload.clipId, note.pitch, note.startBeat, note.duration, note.velocity ?? 100);
            }
            logger.info(`[AI MIDI] Completed ${String(notes.length)} notes (${direction})`);
        },
        describe: () => ({ label: 'AI: complete MIDI phrase' }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'completeMidi'>>,

    variationMidi: {
        execute: async (a) => {
            const existing = getNotesForClip(a.payload.clipId);
            const amount = a.payload.amount ?? 0.3;

            const pct = Math.round(amount * 100);
            const instruction = `Create a variation of these notes. Change ~${String(pct)}% of them — alter some pitches, shift some rhythms, or change velocities, but keep the overall feel and key. Output the COMPLETE set of notes for the clip (replacing all existing notes). The variation should sound like a B-section or alternate take.`;

            const notes = await llmGenerateNotes(instruction, existing, a.payload.clipId);
            // Replace all existing notes with the variation
            const newNotes = notes.map((note) =>
                createMidiNote(
                    Math.max(0, Math.min(127, Math.round(note.pitch))),
                    Math.max(0, note.startBeat),
                    Math.max(0.0625, note.duration),
                    Math.max(1, Math.min(127, note.velocity ?? 100))
                )
            );
            setNotesForClip(a.payload.clipId, newNotes);
            logger.info(`[AI MIDI] Generated variation with ${String(newNotes.length)} notes (replaced ${String(existing.length)} existing)`);
        },
        describe: () => ({ label: 'AI: create MIDI variation' }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'variationMidi'>>,

    generateBassline: {
        execute: async (a) => {
            const referenceNotes = getNotesForClip(a.payload.clipId);
            const style = a.payload.style ?? 'root-fifth';

            // Find or create target track
            let targetId = a.payload.trackId;
            if (!targetId) {
                const newTrack = addTrack({ name: `Bass (${style})`, kind: 'midi' });
                targetId = newTrack?.id;
            }
            if (!targetId) {
                return;
            }

            const instruction = `Generate a ${style} bassline that harmonically fits these chord/melody notes. The bass should be in octave 2-3 (MIDI 36-59). Use a "${style}" pattern. Output the bass notes using addNotes.`;

            const notes = await llmGenerateNotes(instruction, referenceNotes, a.payload.clipId);
            for (const note of notes) {
                addMidiNote(a.payload.clipId, note.pitch, note.startBeat, note.duration, note.velocity ?? 100);
            }
            logger.info(`[AI MIDI] Generated ${style} bassline with ${String(notes.length)} notes`);
        },
        describe: (a) => ({ label: `AI: generate ${a.payload.style ?? 'root-fifth'} bassline` }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'generateBassline'>>,

    // ── Audio analysis (DSP-based, no model needed) ──────────────────────

    detectTempo: {
        execute: async (a) => {
            const bpm = await detectTempo(a.payload.clipId);
            logger.info(`[Analysis] Tempo detected for clip ${a.payload.clipId}: ~${String(bpm)} BPM`);
        },
        describe: () => ({ label: 'Detect tempo' }),
        undoable: false,
    } satisfies ActionHandler<Extract<AppAction, 'detectTempo'>>,

    detectKey: {
        execute: async (a) => {
            const key = await detectKey(a.payload.clipId);
            logger.info(`[Analysis] Key detected for clip ${a.payload.clipId}: ${String(key)}`);
        },
        describe: () => ({ label: 'Detect key' }),
        undoable: false,
    } satisfies ActionHandler<Extract<AppAction, 'detectKey'>>,

    stripSilence: {
        execute: (a) => {
            stripSilence(a.payload.clipId, a.payload.threshold || -40);
            logger.info(`[Analysis] Strip silence executed for clip ${a.payload.clipId}`);
        },
        describe: () => ({ label: 'Strip silence' }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'stripSilence'>>,

    audioToMidi: {
        execute: async (a) => {
            await audioToMidi(a.payload.clipId);
            logger.info(`[Analysis] Audio-to-MIDI mapped for clip ${a.payload.clipId}`);
        },
        describe: () => ({ label: 'Convert audio to MIDI' }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'audioToMidi'>>,

    // ── AI Audio Generation (Stable Audio Open) ─────────────────────────

    generateAudio: {
        execute: async (a) => {
            const { generateAudio: genAudio, isAudioGenerationAvailable } =
                await import('#/modules/AudioAnalysis/useCases/audioAi');

            if (!isAudioGenerationAvailable()) {
                logger.warn('[Audio AI] Audio generation requires the Sourdaw desktop app');
                return;
            }

            let trackId = a.payload.trackId;
            if (!trackId) {
                const newTrack = addTrack({ name: `AI Audio`, kind: 'audio' });
                trackId = newTrack?.id;
            }
            if (!trackId) {
                return;
            }

            const duration = a.payload.durationSeconds ?? 8;
            logger.info(`[Audio AI] Generating: "${a.payload.prompt}" (${String(duration)}s)`);

            try {
                const audioBuffer = await genAudio(a.payload.prompt, duration);
                logger.info(
                    `[Audio AI] Generated ${String(audioBuffer.duration.toFixed(1))}s of audio (${String(audioBuffer.sampleRate)}Hz)`
                );

                // Store the generated audio buffer in the cache
                const bufferId = crypto.randomUUID();
                audioBufferCache.set(bufferId, audioBuffer);

                // Calculate duration in beats (assume current project tempo, fallback 120 BPM)
                const durationBeats = Math.max(1, Math.ceil(audioBuffer.duration * 2));

                // Create a clip on the target track
                const promptLabel = a.payload.prompt.slice(0, 40);
                addClip({
                    trackId,
                    startBeat: 0,
                    endBeat: durationBeats,
                    name: `AI: ${promptLabel}`,
                    type: 'audio',
                    audioBufferId: bufferId,
                });

                logger.info(`[Audio AI] Created clip "${promptLabel}" (${String(durationBeats)} beats) on track ${trackId}`);
            } catch (error) {
                logger.warn(`[Audio AI] Generation failed: ${String(error)}`);
            }
        },
        describe: (a) => ({ label: `AI: generate audio "${a.payload.prompt.slice(0, 30)}"` }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'generateAudio'>>,

    stemSeparate: {
        execute: async (a) => {
            const { separateStems: doSeparateStems } =
                await import('#/modules/AudioAnalysis/useCases/audioAi');

            const stems = a.payload.stems ?? ['all'];
            logger.info(`[Audio AI] Separating stems: ${stems.join(', ')} for clip ${a.payload.clipId}`);

            try {
                // 1. Get audio buffer from clip
                const state = trackStore.value;
                const track = state?.tracks.find((t) => t.clips.some((c) => c.id === a.payload.clipId));
                if (!track) {
                    logger.warn('[Audio AI] Clip not found');
                    return;
                }
                const clip = track.clips.find((c) => c.id === a.payload.clipId);
                if (!clip || clip.type !== 'audio' || !clip.audioBufferId) {
                    logger.warn('[Audio AI] Clip has no audio buffer');
                    return;
                }
                const sourceBuffer = audioBufferCache.get(clip.audioBufferId);
                if (!sourceBuffer) {
                    logger.warn('[Audio AI] Audio buffer not found in cache');
                    return;
                }

                // 2. Convert AudioBuffer to WAV ArrayBuffer for transport
                const wavData = audioBufferToWav(sourceBuffer);

                // 3. Send to Demucs server
                const stemResults = await doSeparateStems(wavData, stems);

                // 4. Create new tracks for each stem with clips
                const durationBeats = clip.endBeat - clip.startBeat;
                for (const [stemName, stemBuffer] of Object.entries(stemResults)) {
                    const stemTrack = addTrack({ name: `${clip.name} — ${stemName}`, kind: 'audio' });
                    if (!stemTrack) {
                        continue;
                    }
                    const stemBufferId = crypto.randomUUID();
                    audioBufferCache.set(stemBufferId, stemBuffer);
                    addClip({
                        trackId: stemTrack.id,
                        startBeat: clip.startBeat,
                        endBeat: clip.startBeat + durationBeats,
                        name: `${stemName}`,
                        type: 'audio',
                        audioBufferId: stemBufferId,
                    });
                }

                logger.info(`[Audio AI] Separated into ${String(Object.keys(stemResults).length)} stems`);
            } catch (error) {
                logger.warn(`[Audio AI] Stem separation failed: ${String(error)}`);
            }
        },
        describe: () => ({ label: 'AI: separate stems' }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'stemSeparate'>>,
};

// ── Helpers ─────────────────────────────────────────────────────────────

/**
 * Encode an AudioBuffer as a 16-bit PCM WAV ArrayBuffer.
 * Used to transport audio data to the stem separation engine.
 */
function audioBufferToWav(buffer: AudioBuffer): ArrayBuffer {
    const numChannels = buffer.numberOfChannels;
    const sampleRate = buffer.sampleRate;
    const format = 1; // PCM
    const bitsPerSample = 16;

    const channels: Float32Array[] = [];
    for (let ch = 0; ch < numChannels; ch++) {
        channels.push(buffer.getChannelData(ch));
    }

    const numSamples = buffer.length;
    const dataLength = numSamples * numChannels * (bitsPerSample / 8);
    const headerLength = 44;
    const arrayBuffer = new ArrayBuffer(headerLength + dataLength);
    const view = new DataView(arrayBuffer);

    // RIFF header
    writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + dataLength, true);
    writeString(view, 8, 'WAVE');

    // fmt chunk
    writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, format, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * numChannels * (bitsPerSample / 8), true);
    view.setUint16(32, numChannels * (bitsPerSample / 8), true);
    view.setUint16(34, bitsPerSample, true);

    // data chunk
    writeString(view, 36, 'data');
    view.setUint32(40, dataLength, true);

    let offset = 44;
    for (let i = 0; i < numSamples; i++) {
        for (let ch = 0; ch < numChannels; ch++) {
            const sample = Math.max(-1, Math.min(1, channels[ch]![i]!));
            view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
            offset += 2;
        }
    }

    return arrayBuffer;
}

function writeString(view: DataView, offset: number, str: string): void {
    for (let i = 0; i < str.length; i++) {
        view.setUint8(offset + i, str.charCodeAt(i));
    }
}
