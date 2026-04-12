import { logger } from '#/infra/logger/appLogger';
import { type ArticulationType } from '../../models/LevainPatch';
import type { SampleLodConfig } from './helpers';
import { fetchAndDecode } from './helpers';

export type ManifestZone = {
    file: string;
    rootNote: number;
    loKey: number;
    hiKey: number;
    loVel: number;
    hiVel: number;
    rrPos: number;
    rrLen: number;
    micId: number;
    isRelease: boolean;
    loopMode: 'none' | 'forward' | 'pingpong';
    loopStart: number;
    loopEnd: number;
    loopCrossfade: number;
    gainDb: number;
    attack: number;
    decay: number;
    sustain: number;
    release: number;
};

export type ManifestArticulation = {
    type: ArticulationType;
    id: number;
    zones: ManifestZone[];
};

// ---------------------------------------------------------------------------
// Manifest types (SFZ-style zone descriptions in JSON)
// ---------------------------------------------------------------------------

export type SampleManifest = {
    version: number;
    instrumentId: string;
    sampleRate: number;
    articulations: ManifestArticulation[];
    micPositions: string[];
};

export const DEFAULT_LOD: SampleLodConfig = {
    maxMics: 0,
    maxVelLayers: 0,
    maxRoundRobins: 0,
    disableTransitions: false,
};

// ---------------------------------------------------------------------------
// Manifest loader
// ---------------------------------------------------------------------------

/**
 * Load a complete instrument from a manifest file.
 * Sends addSample, addZone, and buildZoneMap messages to the worklet node.
 *
 * @param manifestUrl URL to the JSON manifest
 * @param basePath Base path for sample file URLs
 * @param nodePort The worklet node's MessagePort
 * @param lod LOD configuration for memory management
 * @param onProgress Optional progress callback (0-1)
 */
export async function loadInstrumentFromManifest(
    manifestUrl: string,
    basePath: string,
    nodePort: MessagePort,
    lod: SampleLodConfig = DEFAULT_LOD,
    onProgress?: (progress: number) => void
): Promise<void> {
    const response = await fetch(manifestUrl);
    if (!response.ok) {
        throw new Error(`Failed to fetch manifest: ${manifestUrl} (${response.status})`);
    }

    const manifest: SampleManifest = await response.json();

    // Collect all unique sample file URLs.
    const allZones: { zone: ManifestZone; artId: number }[] = [];
    let numMics = manifest.micPositions.length;
    let numArticulations = manifest.articulations.length;

    for (const art of manifest.articulations) {
        for (const zone of art.zones) {
            // Apply LOD filtering.
            if (lod.maxMics > 0 && zone.micId >= lod.maxMics) {
                continue;
            }
            if (lod.maxRoundRobins > 0 && zone.rrPos >= lod.maxRoundRobins) {
                continue;
            }
            allZones.push({ zone, artId: art.id });
        }
    }

    if (lod.maxMics > 0) {
        numMics = Math.min(numMics, lod.maxMics);
    }

    // Send clear command before adding new samples.
    nodePort.postMessage({ type: 'clearZones' });

    // Load and decode all samples.
    const sampleIdMap = new Map<string, number>();
    let nextSampleId = 0;
    let loaded = 0;
    const total = allZones.length;

    for (const { zone } of allZones) {
        if (sampleIdMap.has(zone.file)) {
            loaded++;
            if (onProgress) {
                onProgress(loaded / total);
            }
            continue;
        }

        const url = `${basePath}/${zone.file}`;

        try {
            const { data, frameCount, channels, sampleRate } = await fetchAndDecode(url);

            // Send sample data to worklet.
            const transferable = data.buffer;
            nodePort.postMessage(
                {
                    type: 'addSample',
                    sampleId: nextSampleId,
                    data: data,
                    frameCount,
                    channels,
                    sampleRate,
                },
                [transferable]
            );

            sampleIdMap.set(zone.file, nextSampleId);
            nextSampleId++;
        } catch (err) {
            logger.warn(`[Levain] Failed to load sample ${zone.file}:`, err);
            // DO NOT abort the whole instrument if one file 404s or is bad.
        } finally {
            loaded++;
            if (onProgress) {
                onProgress(loaded / total);
            }
        }
    }

    // Send zone definitions.
    let zoneId = 0;
    for (const { zone, artId } of allZones) {
        const sampleId = sampleIdMap.get(zone.file);
        if (sampleId === undefined) {
            continue;
        }

        nodePort.postMessage({
            type: 'addZone',
            zoneId,
            sampleId,
            articulationId: artId,
            rootNote: zone.rootNote,
            loKey: zone.loKey,
            hiKey: zone.hiKey,
            loVel: zone.loVel,
            hiVel: zone.hiVel,
            rrPos: zone.rrPos,
            rrLen: zone.rrLen,
            micId: zone.micId,
            isRelease: zone.isRelease,
            loopMode: zone.loopMode,
            loopStart: zone.loopStart,
            loopEnd: zone.loopEnd,
            loopCrossfade: zone.loopCrossfade,
            gainDb: zone.gainDb,
            attack: zone.attack,
            decay: zone.decay,
            sustain: zone.sustain,
            release: zone.release,
        });
        zoneId++;
    }

    // Build the zone lookup table.
    nodePort.postMessage({
        type: 'buildZoneMap',
        numArticulations,
        numMics,
    });
}