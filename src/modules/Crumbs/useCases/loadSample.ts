/**
 * Orchestrate loading a sample into the crumbs engine.
 * Calls the Tauri backend, updates stores with metadata and waveform.
 */

import { logger } from '#/infra/logger/appLogger';
import type { SampleMeta } from '../models/CrumbsTypes';
import { getWaveformPeaks, loadSample } from '../repositories/crumbsBridge';
import { setActiveSample, setLoading, setWaveformPeaks } from '../stores/crumbsStore';

export async function loadSampleFromPath(instanceId: string, filePath: string): Promise<void> {
    setLoading(instanceId, true);

    try {
        const result = await loadSample(instanceId, filePath);

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

        setActiveSample(instanceId, meta);

        // Load waveform peaks for display (level 0 = finest).
        try {
            const peaks = await getWaveformPeaks(instanceId, result.sampleId, 0);
            setWaveformPeaks(instanceId, peaks);
        } catch (err) {
            logger.warn('Waveform peak loading failed:', err);
        }

        setLoading(instanceId, false);
    } catch (error) {
        setLoading(instanceId, false);
        throw error;
    }
}
