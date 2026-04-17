import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { trackStore } from '#/modules/Arrangement/stores';
import { kneadStore } from '#/modules/Knead/stores';
import { isTauri } from '#/utils/tauriBridge';
import { getBufferForClip } from '#/modules/Arrangement/useCases';
// @ts-ignore
import { analyze_pitch_wasm } from '#/modules/AudioEngine/wasm/daw_dsp.js';

type PitchPoint = {
    time_ms: number;
    frequency_hz: number;
    confidence: number;
    voiced: boolean;
};

type PitchContour = {
    points: PitchPoint[];
    sample_rate: number;
    hop_size: number;
    algorithm: string;
};

type AnalysisProgress = {
    progress: number;
};

/**
 * Runs the offline native pitch analysis on a full audio clip via Tauri IPC or WASM fallback.
 */
export async function analyzePitchForClip(clipId: string): Promise<PitchContour | null> {
    const tracksState = trackStore.value;
    let targetClip: any = null;
    if (tracksState && tracksState.tracks) {
        for (const track of Object.values(tracksState.tracks)) {
            for (const clip of track.clips) {
                if (clip.id === clipId && clip.type === 'audio') {
                    targetClip = clip;
                    break;
                }
            }
            if (targetClip) break;
        }
    }
    
    if (!targetClip || !targetClip.fileId) {
        return null;
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

    try {
        let contour: PitchContour;
        
        if (isTauri()) {
            unlisten = await listen<AnalysisProgress>('pitch-analysis-progress', (event) => {
                const currentState = kneadStore.value;
                if (currentState) {
                    kneadStore.set({
                        ...currentState,
                        analysisProgress: event.payload.progress,
                    });
                }
            });

            contour = await invoke('analyze_pitch', {
                audioPath: targetClip.fileId,
            }) as PitchContour;
        } else {
            // WASM fallback
            const result = getBufferForClip(clipId);
            if (!result || !result.buffer) {
                throw new Error('Could not get audio buffer for clip');
            }
            
            // Artificial progress steps to keep UI somewhat responsive
            const progressSteps = [0.2, 0.5, 0.8];
            for (const step of progressSteps) {
                await new Promise(r => setTimeout(r, 0));
                const s = kneadStore.value;
                if (s) {
                    kneadStore.set({ ...s, analysisProgress: step });
                }
            }

            const channelData = result.buffer.getChannelData(0);
            const jsonStr = analyze_pitch_wasm(channelData, result.buffer.sampleRate);
            contour = JSON.parse(jsonStr);
        }

        // Store the result
        const finalState = kneadStore.value;
        if (finalState) {
            kneadStore.set({
                ...finalState,
                ...({ pitchContour: contour } as any),
            });
        }

        return contour;
    } catch (err) {
        console.error('Pitch analysis failed:', err);
        throw err;
    } finally {
        if (unlisten) {
            unlisten();
        }
        
        const endState = kneadStore.value;
        if (endState) {
            kneadStore.set({
                ...endState,
                isAnalyzing: false,
                analysisProgress: 1,
            });
        }
    }
}
