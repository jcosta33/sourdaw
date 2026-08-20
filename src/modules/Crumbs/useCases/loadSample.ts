/**
 * Orchestrate loading a sample into the crumbs engine.
 * Calls the native backend, updates stores with metadata and waveform.
 */

import { logger } from '#/infra/logger/appLogger';
import { basename_from_path } from '#/utils/path-basename';

import { getWaveformPeaks } from '../repositories/crumbsBridge/getWaveformPeaks';
import { loadSample } from '../repositories/crumbsBridge/loadSample';
import { setActiveSample, setLoading, setWaveformPeaks } from '../stores/crumbsStore';

import type { SampleCategory, SampleMeta } from '../models/CrumbsTypes';

/** The backend's level-0 mipmap block size (`MIPMAP_BASE_BLOCK` in daw-dsp). */
const MIPMAP_BASE_BLOCK = 64;

/** Fallback render width (px) when no canvas measurement is available yet. */
const DEFAULT_WAVEFORM_WIDTH = 800;

const KNOWN_CATEGORIES: ReadonlySet<SampleCategory> = new Set<SampleCategory>([
    'percussive',
    'tonal',
    'loop',
    'unknown',
]);

/**
 * Narrow the backend's free-form category string to the {@link SampleCategory}
 * union at the IPC boundary. A category the frontend doesn't recognise (e.g. a
 * value added to the Rust classifier ahead of the TS union) is coerced to
 * `'unknown'` rather than silently widening `SampleMeta.category` to an
 * arbitrary string — which would otherwise leak through `categoryToMode`'s
 * default branch and render an invalid `<select>` value.
 */
function toSampleCategory(category: string): SampleCategory {
    return KNOWN_CATEGORIES.has(category as SampleCategory) ? (category as SampleCategory) : 'unknown';
}

/**
 * Choose the mipmap level whose resolution best matches a target display width,
 * mirroring the backend's `select_level`. Level N holds one peak pair per
 * `64 × 2^N` frames; we want ~2 pairs per pixel. Returning a width-derived level
 * instead of a hard-coded `0` keeps the IPC payload O(width) rather than
 * O(frameCount) — a ~60s recording at 48kHz is ~2.9M frames, ~90k level-0 pairs,
 * versus ~1.6k pairs at level 0's coarser counterpart for an 800px canvas.
 */
function selectMipmapLevel(frameCount: number, targetWidth: number): number {
    if (frameCount <= 0 || targetWidth <= 0) {
        return 0;
    }

    // Coarsest valid level: level-0 has ceil(frameCount / block) pairs, and each
    // level halves the pair count until a single pair remains. Clamp to this so
    // we never request a level the backend would reject as out of range.
    const level0Pairs = Math.ceil(frameCount / MIPMAP_BASE_BLOCK);
    const maxLevel = level0Pairs <= 1 ? 0 : Math.ceil(Math.log2(level0Pairs));

    const desiredPairs = targetWidth * 2;
    const framesPerPairNeeded = frameCount / Math.max(desiredPairs, 1);

    // Finest level whose blocks are at least as coarse as needed (== backend).
    for (let level = 0; level <= maxLevel; level++) {
        const framesPerPair = MIPMAP_BASE_BLOCK * 2 ** level;
        if (framesPerPair >= framesPerPairNeeded) {
            return level;
        }
    }

    return maxLevel;
}

export async function loadSampleFromPath(
    instanceId: string,
    filePath: string,
    targetWidth: number = DEFAULT_WAVEFORM_WIDTH
): Promise<void> {
    setLoading(instanceId, true);

    try {
        const result = await loadSample(instanceId, filePath);
        if (result.decodeWarningCount > 0) {
            const packetLabel = result.decodeWarningCount === 1 ? 'packet' : 'packets';
            logger.warn(
                `Sample imported after skipping ${String(result.decodeWarningCount)} corrupt audio ${packetLabel}:`,
                result.decodeWarnings
            );
        }

        const fileName = basename_from_path(filePath);
        const meta: SampleMeta = {
            sampleId: result.sampleId,
            sampleRate: result.sampleRate,
            channels: result.channels,
            frameCount: result.frameCount,
            durationSecs: result.durationSecs,
            detectedRoot: result.detectedRoot,
            detectedBpm: result.detectedBpm,
            category: toSampleCategory(result.category),
            filePath,
            fileName,
        };

        setActiveSample(instanceId, meta);

        // Load waveform peaks for display at a level sized to the canvas, not the
        // recording length (avoids an enormous IPC payload for long samples).
        try {
            const level = selectMipmapLevel(result.frameCount, targetWidth);
            const peaks = await getWaveformPeaks(instanceId, result.sampleId, level);
            setWaveformPeaks(instanceId, peaks);
        } catch (error) {
            logger.warn('Waveform peak loading failed:', error);
        }

        setLoading(instanceId, false);
    } catch (error) {
        setLoading(instanceId, false);
        throw error;
    }
}
