/**
 * Tauri IPC bridge for the Unified Crumbs Suite.
 * All backend calls go through tauriInvoke — the single shared bridge.
 */

import { isTauri, tauriInvoke } from '#/utils/tauriBridge';

import type {
    LoopPointDetectionResult,
    MeteringResult,
    OnsetAlgorithm,
    OnsetDetectionResult,
    CrumbsLoadResult,
    CrumbsMode,
} from '../models/CrumbsTypes';

// Every entry point here walks through `tauriInvoke`, which throws a generic
// "window.__TAURI_INTERNALS__ is undefined" error in non-Tauri contexts. We
// short-circuit with a readable message so browser callers get a diagnosable
// failure instead of a raw runtime throw. Data-returning calls throw; void
// calls return early.
function ensureTauri(command: string): void {
    if (!isTauri()) {
        throw new Error(`Crumbs IPC "${command}" is only available in the Sourdaw desktop app`);
    }
}

export async function createCrumbsInstance(instanceId: string, sampleRate: number): Promise<void> {
    if (!isTauri()) {
        return;
    }
    await tauriInvoke('create_crumbs', { instanceId, sampleRate });
}

export async function destroyCrumbsInstance(instanceId: string): Promise<void> {
    if (!isTauri()) {
        return;
    }
    await tauriInvoke('destroy_crumbs', { instanceId });
}

export async function loadSample(instanceId: string, filePath: string): Promise<CrumbsLoadResult> {
    ensureTauri('load_sample');
    const result = await tauriInvoke('load_sample', { instanceId, filePath });
    return result as CrumbsLoadResult;
}

export async function crumbsNoteOn(instanceId: string, note: number, velocity: number): Promise<void> {
    if (!isTauri()) {
        return;
    }
    await tauriInvoke('crumbs_note_on', { instanceId, note, velocity });
}

export async function crumbsNoteOff(instanceId: string, note: number): Promise<void> {
    if (!isTauri()) {
        return;
    }
    await tauriInvoke('crumbs_note_off', { instanceId, note });
}

export async function setCrumbsParam(instanceId: string, param: string, value: number): Promise<void> {
    if (!isTauri()) {
        return;
    }
    await tauriInvoke('set_crumbs_param', { instanceId, param, value });
}

export async function setCrumbsMode(instanceId: string, mode: CrumbsMode): Promise<void> {
    if (!isTauri()) {
        return;
    }
    await tauriInvoke('set_crumbs_mode', { instanceId, mode });
}

export async function getWaveformPeaks(
    instanceId: string,
    sampleId: number,
    level: number,
    channel: number = 0
): Promise<number[]> {
    ensureTauri('get_waveform_peaks');
    const result = await tauriInvoke('get_waveform_peaks', { instanceId, sampleId, level, channel });

    // Binary IPC returns ArrayBuffer — convert to f32 array.
    if (result instanceof ArrayBuffer) {
        return Array.from(new Float32Array(result));
    }

    // Fallback for JSON response.
    return result as number[];
}

export async function detectOnsets(
    instanceId: string,
    sampleId: number,
    algorithm: OnsetAlgorithm
): Promise<OnsetDetectionResult> {
    ensureTauri('detect_onsets');
    const result = await tauriInvoke('detect_onsets', { instanceId, sampleId, algorithm });
    return result as OnsetDetectionResult;
}

export async function getCrumbsMetering(instanceId: string): Promise<MeteringResult> {
    ensureTauri('get_crumbs_metering');
    const result = await tauriInvoke('get_crumbs_metering', { instanceId });
    return result as MeteringResult;
}

export async function getCrumbsPosition(instanceId: string): Promise<number> {
    ensureTauri('get_crumbs_position');
    const result = await tauriInvoke('get_crumbs_position', { instanceId });
    return result as number;
}

export async function detectSmartLoopPoints(
    instanceId: string,
    sampleId: number
): Promise<LoopPointDetectionResult | null> {
    ensureTauri('detect_smart_loop_points');
    const result = await tauriInvoke('detect_smart_loop_points', { instanceId, sampleId });
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
