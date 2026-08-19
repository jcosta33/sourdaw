import { logger } from '#/infra/logger/appLogger';
import { trackStore } from '#/modules/Arrangement/stores';
import analyzePitchWasmModule, { analyze_pitch_wasm } from '#/modules/AudioEngine/wasm/daw_dsp.js';

import { analyzeNativePitch } from '../../repositories/audioAnalysis/analyze-native-pitch';
import { listenPitchAnalysisProgress } from '../../repositories/audioAnalysis/listen-pitch-analysis-progress';
import { audioBufferCache } from '../../stores/audioBufferCache';

// `daw_dsp.js` is a wasm-bindgen module whose glue (`__wbindgen_free` etc.) is a
// realm singleton. The GrandBoule AudioWorklet inits its own copy in the
// worklet realm; the main thread never did, so `analyze_pitch_wasm` (and
// `commit_pitch_edit_wasm`) read `undefined.__wbindgen_free` and threw on every
// browser-side Knead analysis — the editor then hung on the "Analyzing…"
// spinner because the throw propagated without resetting `isAnalyzing`. The
// default export is the standard wasm-bindgen async init (`__wbg_init`);
// memoize one main-thread init the same way `decodeAudioBytesWasm` does.
let mainThreadInitPromise: Promise<unknown> | null = null;
function ensureMainThreadWasmInit(): Promise<unknown> {
    if (!mainThreadInitPromise) {
        mainThreadInitPromise = analyzePitchWasmModule();
    }
    return mainThreadInitPromise;
}

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
    algorithm?: string;
};

export type PitchSegment = {
    start_time_ms: number;
    end_time_ms: number;
    shift_semitones: number;
};

type AnalyzePitchForClipOutput =
    { status: 'analyzed'; contour: PitchContour } | { status: 'no-buffer'; reason: 'missing-clip-or-buffer' };

type AnalyzePitchForClipInput = {
    clipId: string;
    onStart: () => void;
    onProgress: (progress: number) => void;
};

type AnalyzePitchWithWasmInput = {
    targetClip: PitchAnalysisClip;
    onProgress: (progress: number) => void;
};

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

async function analyzePitchWithWasm({ targetClip, onProgress }: AnalyzePitchWithWasmInput): Promise<PitchContour> {
    const buffer = getCachedAudioBuffer(targetClip);
    if (!buffer) {
        throw new Error('Could not get audio buffer for clip');
    }

    // The wasm-bindgen glue must be initialized on the main thread before any
    // `daw_dsp` export is read — see `ensureMainThreadWasmInit` above.
    await ensureMainThreadWasmInit();

    // Artificial progress steps to keep UI somewhat responsive.
    const progressSteps = [0.2, 0.5, 0.8];
    for (const step of progressSteps) {
        await new Promise((resolve) => setTimeout(resolve, 0));
        onProgress(step);
    }

    const channelData = buffer.getChannelData(0);
    const jsonStr = analyze_pitch_wasm(channelData, buffer.sampleRate);
    return JSON.parse(jsonStr) as PitchContour;
}

/**
 * Runs the offline native pitch analysis on a full audio clip via native IPC or WASM fallback.
 */
export async function analyzePitchForClip({
    clipId,
    onStart,
    onProgress,
}: AnalyzePitchForClipInput): Promise<AnalyzePitchForClipOutput> {
    const targetClip = findAudioClip(clipId);

    if (!targetClip || !targetClip.audioBufferId) {
        logger.info(`[analyzePitchForClip] no buffer resolved for clipId=${clipId}`);
        return { status: 'no-buffer', reason: 'missing-clip-or-buffer' };
    }

    const analysisId = crypto.randomUUID();
    let unlisten: (() => void) | null = null;

    try {
        onStart();
        unlisten = await listenPitchAnalysisProgress({
            analysisId,
            onProgress,
        });

        let contour: PitchContour | null = null;
        if (unlisten) {
            contour = await analyzeNativePitch({
                analysisId,
                audioPath: targetClip.fileId ?? targetClip.audioBufferId,
            });
        }

        if (!contour) {
            contour = await analyzePitchWithWasm({ targetClip, onProgress });
        }

        return { status: 'analyzed', contour };
    } catch (error) {
        console.error('Pitch analysis failed:', error);
        throw error;
    } finally {
        if (unlisten) {
            unlisten();
        }
    }
}
