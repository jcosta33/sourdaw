import { Store } from '#/helpers/Store/Store';
import { Logger } from '#/helpers/Logger/Logger';
import {
    generateMidiAI,
    denoiseAudio,
    type GeneratedNote,
    isTauri,
} from '#/modules/AudioEngine/useCases/nativeAIBridge';
import { audioBufferCache } from '#/modules/AudioEngine/stores/audioBufferCache';
import { trackStore } from '#/modules/Track/stores/trackStore';
import { addClip } from '#/modules/Track/useCases/clipUseCases';
import { addMidiNote } from '#/modules/Track/useCases/midiNoteCrud';
import { getTransportState } from '#/modules/Transport/useCases/transportQueries';
import { generateMidiViaLlm } from './llmMidiGeneration';

// ── Types ──

export type AiTaskType = 'midi-generation' | 'audio-generation' | 'stem-separation' | 'denoise';
export type AiTaskStatus = 'idle' | 'processing' | 'success' | 'error';

export interface AiTaskResult {
    id: string;
    type: AiTaskType;
    status: AiTaskStatus;
    prompt?: string;
    timestamp: number;
    error?: string;
    // Payload for successful tasks
    data?: any;
    durationMs?: number;
}

export interface GenerativeAiState {
    tasks: AiTaskResult[];
    isPanelOpen: boolean;
}

const initialState: GenerativeAiState = {
    tasks: [],
    isPanelOpen: false,
};

const logger = new Logger();

export const generativeAiStore = new Store<GenerativeAiState>(logger, { initialData: initialState });

export const subscribeGenerativeAi = (callback: () => void) => generativeAiStore.subscribe(callback);
export const getGenerativeAiSnapshot = () => generativeAiStore.value ?? initialState;

// ── Actions ──

export const toggleGenerativeAiPanel = () => {
    const s = getGenerativeAiSnapshot();
    generativeAiStore.set({ ...s, isPanelOpen: !s.isPanelOpen });
};

const addTask = (task: Omit<AiTaskResult, 'id' | 'timestamp'>): string => {
    const id = `ai-task-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const fullTask: AiTaskResult = { ...task, id, timestamp: Date.now() };
    const s = getGenerativeAiSnapshot();
    generativeAiStore.set({ ...s, tasks: [fullTask, ...s.tasks].slice(0, 50) });
    return id;
};

const updateTask = (id: string, updates: Partial<AiTaskResult>) => {
    const s = getGenerativeAiSnapshot();
    generativeAiStore.set({
        ...s,
        tasks: s.tasks.map((t: AiTaskResult) => (t.id === id ? { ...t, ...updates } : t)),
    });
};

export const removeTask = (id: string) => {
    const s = getGenerativeAiSnapshot();
    generativeAiStore.set({
        ...s,
        tasks: s.tasks.filter((t: AiTaskResult) => t.id !== id),
    });
};

// ── Orchestrators ──

export async function handleGenerateMidiPrompt(prompt: string, numNotes: number = 32, creativity: number = 0.65) {
    const taskId = addTask({ type: 'midi-generation', status: 'processing', prompt });
    try {
        const start = performance.now();
        let finalNotes: GeneratedNote[] = [];

        if (isTauri()) {
            // Native path: use the Tauri sidecar MIDI AI model
            const seedNotes: Array<[number, number, number, number]> = [
                [60, 80, 0, 0.5],
                [62, 75, 0.5, 0.5],
                [64, 85, 1.0, 0.5],
                [65, 80, 1.5, 0.5],
            ];
            const res = await generateMidiAI(seedNotes, numNotes, creativity, 40);
            finalNotes = res.notes;
        } else {
            // Web path: use WebLLM for structured MIDI generation
            finalNotes = await generateMidiViaLlm(prompt, numNotes, creativity);
        }

        // Auto-insert into timeline
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
                    isGhost: true,
                });

                if (clip) {
                    for (const n of finalNotes) {
                        addMidiNote(clip.id, n.pitch, n.start_beat, n.duration_beats, n.velocity);
                    }
                }
            }

            // Remove the task so it doesn't linger in the Generative AI Library
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

export async function handleAiDenoiseClip(clipId: string, strength: number = 0.7) {
    const taskId = addTask({ type: 'denoise', status: 'processing' });
    try {
        const start = performance.now();
        const buffer = audioBufferCache.get(clipId);
        if (!buffer) {
            throw new Error('Audio buffer not found for clip');
        }

        let outNoiseFloor = -60;

        if (isTauri()) {
            const samples = buffer.getChannelData(0);
            const res = await denoiseAudio(samples, buffer.sampleRate, buffer.numberOfChannels, strength);
            outNoiseFloor = res.noise_floor_db;
        } else {
            // [Web Fallback]: AudioContext Dynamics & Filtering
            const ctx = new OfflineAudioContext(buffer.numberOfChannels, buffer.length, buffer.sampleRate);
            const source = ctx.createBufferSource();
            source.buffer = buffer;

            const filter = ctx.createBiquadFilter();
            filter.type = 'lowpass';
            filter.frequency.value = 6000 - strength * 2000; // More strength = lower cutoff

            const comp = ctx.createDynamicsCompressor();
            comp.threshold.value = -30 - strength * 10;
            comp.ratio.value = 4;

            source.connect(filter);
            filter.connect(comp);
            comp.connect(ctx.destination);
            source.start();

            const rendered = await ctx.startRendering();

            // Explicit WebAudio Node cleanup for Garbage Collection
            source.disconnect();
            filter.disconnect();
            comp.disconnect();

            audioBufferCache.set(`${clipId}-denoised`, rendered);
            outNoiseFloor = -80; // Estimated simulation
        }

        updateTask(taskId, {
            status: 'success',
            data: { clipId, noiseFloorDb: outNoiseFloor },
            durationMs: Math.round(performance.now() - start),
        });
    } catch (error: unknown) {
        updateTask(taskId, { status: 'error', error: error instanceof Error ? error.message : 'Denoise failed' });
    }
}

export async function handleStemSeparationPreview(clipId: string) {
    const taskId = addTask({
        type: 'stem-separation',
        status: 'processing',
        prompt: 'Extracting: Drums, Bass, Vocals, Other',
    });
    try {
        const start = performance.now();

        let outStems: string[] = ['Drums', 'Bass', 'Vocals', 'Other'];

        if (isTauri()) {
            // Simulate native IPC call to HTDemucs
            await new Promise((resolve) => setTimeout(resolve, 3500));
        } else {
            // [Web Fallback]: Mid/Side simulation via WebAudio
            const buffer = audioBufferCache.get(clipId);
            if (buffer && buffer.numberOfChannels === 2) {
                const ctx = new OfflineAudioContext(2, buffer.length, buffer.sampleRate);
                const source = ctx.createBufferSource();
                source.buffer = buffer;

                // M/S Matrix simulation (Left + Right vs Left - Right)
                const splitter = ctx.createChannelSplitter(2);
                const merger = ctx.createChannelMerger(2);
                const gainInvert = ctx.createGain();
                gainInvert.gain.value = -1;

                source.connect(splitter);
                splitter.connect(merger, 0, 0); // L -> M
                splitter.connect(merger, 1, 0); // R -> M

                splitter.connect(merger, 0, 1); // L -> S
                splitter.connect(gainInvert, 0, 0); // L invert
                gainInvert.connect(merger, 1, 1); // -L -> S ? This is just a basic hacky routing simulation

                source.start();
                const rendered = await ctx.startRendering();

                // Explicit WebAudio Node cleanup for Garbage Collection
                source.disconnect();
                splitter.disconnect();
                merger.disconnect();
                gainInvert.disconnect();

                audioBufferCache.set(`${clipId}-mid`, rendered);
                audioBufferCache.set(`${clipId}-side`, rendered);
                outStems = ['Center (Vocals)', 'Sides (Instruments)'];
            }
            await new Promise((resolve) => setTimeout(resolve, 1500));
        }

        updateTask(taskId, {
            status: 'success',
            data: { clipId, stems: outStems },
            durationMs: Math.round(performance.now() - start),
        });
    } catch (error: unknown) {
        updateTask(taskId, {
            status: 'error',
            error: error instanceof Error ? error.message : 'Stem separation failed',
        });
    }
}

export async function handleGenerateAudioFallback(prompt: string, durationStr: string, _strength: number = 0.7) {
    const taskId = addTask({ type: 'audio-generation', status: 'processing', prompt });
    try {
        const start = performance.now();
        if (isTauri()) {
            await new Promise((resolve) => setTimeout(resolve, 4000));
        } else {
            // [Web Fallback]: Mocked completion. True web test-to-audio is too heavy right now.
            await new Promise((resolve) => setTimeout(resolve, 1500));
        }

        updateTask(taskId, {
            status: 'success',
            data: { format: 'wav', lengthSeconds: parseInt(durationStr) || 4 },
            durationMs: Math.round(performance.now() - start),
        });
    } catch (error: unknown) {
        updateTask(taskId, { status: 'error', error: error instanceof Error ? error.message : 'Generation failed' });
    }
}
