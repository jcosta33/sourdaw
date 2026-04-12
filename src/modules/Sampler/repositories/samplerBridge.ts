/**
 * Tauri IPC bridge for the Unified Sampler Suite.
 * All backend calls go through tauriInvoke — the single shared bridge.
 */

import { isTauri, tauriInvoke } from '#/utils/tauriBridge';
import type {
    LoopPointDetectionResult,
    MeteringResult,
    OnsetAlgorithm,
    OnsetDetectionResult,
    PitchDetectionResult,
    SamplerLoadResult,
    SamplerMode,
} from '../models/SamplerTypes';

export async function createSamplerInstance(instanceId: string, sampleRate: number): Promise<void> {
    if (!isTauri()) {
        return;
    }
    await tauriInvoke('create_sampler', { instanceId, sampleRate });
}

export async function destroySamplerInstance(instanceId: string): Promise<void> {
    if (!isTauri()) {
        return;
    }
    await tauriInvoke('destroy_sampler', { instanceId });
}

export async function loadSample(instanceId: string, filePath: string): Promise<SamplerLoadResult> {
    const result = await tauriInvoke('load_sample', { instanceId, filePath });
    return result as SamplerLoadResult;
}

export async function samplerNoteOn(instanceId: string, note: number, velocity: number): Promise<void> {
    if (!isTauri()) {
        return;
    }
    await tauriInvoke('sampler_note_on', { instanceId, note, velocity });
}

export async function samplerNoteOff(instanceId: string, note: number): Promise<void> {
    if (!isTauri()) {
        return;
    }
    await tauriInvoke('sampler_note_off', { instanceId, note });
}

export async function setSamplerParam(instanceId: string, param: string, value: number): Promise<void> {
    if (!isTauri()) {
        return;
    }
    await tauriInvoke('set_sampler_param', { instanceId, param, value });
}

export async function setSamplerMode(instanceId: string, mode: SamplerMode): Promise<void> {
    if (!isTauri()) {
        return;
    }
    await tauriInvoke('set_sampler_mode', { instanceId, mode });
}

export async function getWaveformPeaks(instanceId: string, level: number, channel: number = 0): Promise<number[]> {
    const result = await tauriInvoke('get_waveform_peaks', { instanceId, level, channel });

    // Binary IPC returns ArrayBuffer — convert to f32 array.
    if (result instanceof ArrayBuffer) {
        return Array.from(new Float32Array(result));
    }

    // Fallback for JSON response.
    return result as number[];
}

export async function detectOnsets(instanceId: string, algorithm: OnsetAlgorithm): Promise<OnsetDetectionResult> {
    const result = await tauriInvoke('detect_onsets', { instanceId, algorithm });
    return result as OnsetDetectionResult;
}

export async function detectSamplePitch(instanceId: string): Promise<PitchDetectionResult> {
    const result = await tauriInvoke('detect_sample_pitch', { instanceId });
    return result as PitchDetectionResult;
}

export async function getSamplerMetering(instanceId: string): Promise<MeteringResult> {
    const result = await tauriInvoke('get_sampler_metering', { instanceId });
    return result as MeteringResult;
}

export async function samplerAllSoundOff(instanceId: string): Promise<void> {
    if (!isTauri()) {
        return;
    }
    await tauriInvoke('sampler_all_sound_off', { instanceId });
}

export async function getSamplerPosition(instanceId: string): Promise<number> {
    const result = await tauriInvoke('get_sampler_position', { instanceId });
    return result as number;
}

export async function detectSmartLoopPoints(instanceId: string): Promise<LoopPointDetectionResult | null> {
    const result = await tauriInvoke('detect_smart_loop_points', { instanceId });
    return result as LoopPointDetectionResult | null;
}

export async function armRecording(
    instanceId: string,
    threshold: number,
    targetPad: number,
    maxDurationSecs: number
): Promise<void> {
    if (!isTauri()) {
        return;
    }
    await tauriInvoke('arm_recording', { instanceId, threshold, targetPad, maxDurationSecs });
}

export async function stopRecording(instanceId: string): Promise<void> {
    if (!isTauri()) {
        return;
    }
    await tauriInvoke('stop_recording', { instanceId });
}
