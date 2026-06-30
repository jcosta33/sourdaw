import { logger } from '#/infra/logger/appLogger';
import { trackStore } from '#/modules/Arrangement/stores';
import { analyze_pitch_wasm } from '#/modules/AudioEngine/wasm/daw_dsp.js';
import { kneadStore } from '#/modules/Knead/stores';

import { analyzeNativePitch } from '../../repositories/audioAnalysis/analyze-native-pitch';
import { listenPitchAnalysisProgress } from '../../repositories/audioAnalysis/listen-pitch-analysis-progress';
import { audioBufferCache } from '../../stores/audioBufferCache';

export type PitchPoint = {
    time_ms: number;
    frequency_hz: number;
    confidence: number;
    voiced: boolean;
};

export type PitchContour = {
    points: PitchPoint[];
    sample_rate: number;
    hop_size: number;
    algorithm: string;
};

export type PitchSegment = {
    start_time_ms: number;
    end_time_ms: number;
    shift_semitones: number;
};

type AnalyzePitchForClipOutput =
    | { status: 'analyzed'; contour: PitchContour }
    | { status: 'no-buffer'; reason: 'missing-clip-or-buffer' };

type PitchAnalysisClip = {
    id: string;
    type: 'audio';
    fileId?: string;
    audioBufferId?: string;
};

function findAudioClip(clipId: string): PitchAnalysisClip | null {
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

function getCachedAudioBuffer(clip: PitchAnalysisClip): AudioBuffer | null {
    if (!clip.audioBufferId) {
        return null;
    }
    return audioBufferCache.get(clip.audioBufferId) ?? null;
}

function setAnalysisProgress(progress: number): void {
    const state = kneadStore.value;
    if (state) {
        kneadStore.set({ ...state, analysisProgress: progress });
    }
}

async function analyzePitchWithWasm(targetClip: PitchAnalysisClip): Promise<PitchContour> {
    const buffer = getCachedAudioBuffer(targetClip);
    if (!buffer) {
        throw new Error('Could not get audio buffer for clip');
    }

    // Artificial progress steps to keep UI somewhat responsive.
    const progressSteps = [0.2, 0.5, 0.8];
    for (const step of progressSteps) {
        await new Promise((resolve) => setTimeout(resolve, 0));
        setAnalysisProgress(step);
    }

    const channelData = buffer.getChannelData(0);
    const jsonStr = analyze_pitch_wasm(channelData, buffer.sampleRate);
    return JSON.parse(jsonStr) as PitchContour;
}

/**
 * Runs the offline native pitch analysis on a full audio clip via Tauri IPC or WASM fallback.
 */
export async function analyzePitchForClip(clipId: string): Promise<AnalyzePitchForClipOutput> {
    const targetClip = findAudioClip(clipId);

    if (!targetClip || !targetClip.audioBufferId) {
        logger.info(`[analyzePitchForClip] no buffer resolved for clipId=${clipId}`);
        return { status: 'no-buffer', reason: 'missing-clip-or-buffer' };
    }

    // Set analyzing state in store
    const startState = kneadStore.value;
    if (startState) {
        kneadStore.set({
            ...startState,
            isAnalyzing: true,
            analysisProgress: 0,
        });
    }

    let unlisten: (() => void) | null = null;
    let didAnalyze = false;

    try {
        unlisten = await listenPitchAnalysisProgress({
            onProgress: setAnalysisProgress,
        });

        let contour: PitchContour | null = null;
        if (unlisten) {
            contour = await analyzeNativePitch({
                audioPath: targetClip.fileId ?? targetClip.audioBufferId,
            });
        }

        if (!contour) {
            contour = await analyzePitchWithWasm(targetClip);
        }

        // Store the raw contour for the faint background trace in the editor.
        const finalState = kneadStore.value;
        if (finalState) {
            kneadStore.set({
                ...finalState,
                contours: {
                    ...finalState.contours,
                    [clipId]: contour,
                },
            });
        }
        didAnalyze = true;

        // Blob ingestion is the Knead side's responsibility: the Knead-side
        // orchestrator (`analyzeClipPitch`) feeds this contour into
        // `ingestDspAnalysis` after analysis returns, so AudioEngine never has
        // to import the Knead use-case barrel (which would close a cycle).
        return { status: 'analyzed', contour };
    } catch (error) {
        console.error('Pitch analysis failed:', error);
        throw error;
    } finally {
        if (unlisten) {
            unlisten();
        }

        const endState = kneadStore.value;
        if (endState) {
            kneadStore.set({
                ...endState,
                isAnalyzing: false,
                analysisProgress: didAnalyze ? 1 : 0,
            });
        }
    }
}
