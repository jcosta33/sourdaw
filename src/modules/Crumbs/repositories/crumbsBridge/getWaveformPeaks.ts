import { tauriInvoke } from '#/utils/tauriBridge';

import { ensureTauri } from './helpers';

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
