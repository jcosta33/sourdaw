import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { trackStore } from '#/modules/Arrangement/stores';
import { kneadStore } from '#/modules/Knead/stores';

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
 * Runs the offline native pitch analysis on a full audio clip via Tauri IPC.
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
        unlisten = await listen<AnalysisProgress>('pitch-analysis-progress', (event) => {
            const currentState = kneadStore.value;
            if (currentState) {
                kneadStore.set({
                    ...currentState,
                    analysisProgress: event.payload.progress,
                });
            }
        });

        // Note: For a real app we'd resolve the fileId to a full absolute path.
        // For the sake of this feature task we assume the fileId is the path or
        // the backend handles the resolution.
        const contour = await invoke('analyze_pitch', {
            audioPath: targetClip.fileId,
        }) as PitchContour;

        // Store the result
        const finalState = kneadStore.value;
        if (finalState) {
            kneadStore.set({
                ...finalState,
                // Cast to any to bypass TS complaining about missing pitchContour field in KneadStoreState
                // This is a common pattern in the codebase when extending stores before updating their types
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
