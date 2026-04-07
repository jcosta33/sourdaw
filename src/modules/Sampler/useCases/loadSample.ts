/**
 * Orchestrate loading a sample into the sampler engine.
 * Calls the Tauri backend, updates stores with metadata and waveform.
 */

import type { SampleMeta } from '../models/SamplerTypes';
import * as bridge from '../repositories/samplerBridge';
import { samplerStore, setActiveSample, setLoading, setWaveformPeaks } from '../stores/samplerStore';

export async function loadSampleFromPath(filePath: string): Promise<void> {
    const state = samplerStore.value;
    if (!state?.instanceId) return;

    setLoading(true);

    try {
        const result = await bridge.loadSample(state.instanceId, filePath);

        const fileName = filePath.split('/').pop() ?? filePath.split('\\').pop() ?? filePath;
        const meta: SampleMeta = {
            sampleId: result.sampleId,
            sampleRate: result.sampleRate,
            channels: result.channels,
            frameCount: result.frameCount,
            durationSecs: result.durationSecs,
            detectedRoot: result.detectedRoot,
            detectedBpm: result.detectedBpm,
            category: result.category as SampleMeta['category'],
            filePath,
            fileName,
        };

        setActiveSample(meta);

        // Load waveform peaks for display (level 0 = finest).
        try {
            const peaks = await bridge.getWaveformPeaks(state.instanceId, 0);
            setWaveformPeaks(peaks);
        } catch (err) {
            console.error('Waveform peak loading failed:', err);
        }

        setLoading(false);
    } catch (error) {
        setLoading(false);
        throw error;
    }
}
