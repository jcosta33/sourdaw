import { logger } from '#/infra/logger/appLogger';

import { type ArticulationType } from '../../models/LevainPatch';

import { fetchAndDecode } from './fetchAndDecode';
import { type SampleLodConfig } from './helpers';

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
    maxRoundRobins: 0,
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
 * @param signal Optional abort signal. When a newer load supersedes this one,
 *   the caller aborts it; this loader then bails without posting `clearZones`,
 *   `addSample`, or `buildZoneMap`, so the superseded load never overwrites the
 *   worklet zone map the newer load built.
 */
export async function loadInstrumentFromManifest(
    manifestUrl: string,
    basePath: string,
    nodePort: MessagePort,
    lod: SampleLodConfig = DEFAULT_LOD,
    onProgress?: (progress: number) => void,
    signal?: AbortSignal
): Promise<void> {
    const response = await fetch(manifestUrl, signal ? { signal } : undefined);
    if (!response.ok) {
        throw new Error(`Failed to fetch manifest: ${manifestUrl} (${response.status})`);
    }

    const manifest = (await response.json()) as SampleManifest;

    // Collect all unique sample file URLs.
    const allZones: { zone: ManifestZone; artId: number }[] = [];
    let numMics = manifest.micPositions.length;
    const numArticulations = manifest.articulations.length;

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

    // A newer load may have superseded this one while the manifest fetched.
    // Bail before clearing zones so we don't wipe the newer load's map.
    if (signal?.aborted) {
        return;
    }

    // Send clear command before adding new samples.
    nodePort.postMessage({ type: 'clearZones' });

    // Pre-assign a stable sampleId to every unique file so fetches can run
    // in parallel without racing on a shared counter. Path segments are
    // individually `encodeURIComponent`-ed so filenames containing `#`,
    // spaces, or other reserved characters don't 404.
    const sampleIdMap = new Map<string, number>();
    const uniqueFiles: string[] = [];
    for (const { zone } of allZones) {
        if (!sampleIdMap.has(zone.file)) {
            sampleIdMap.set(zone.file, uniqueFiles.length);
            uniqueFiles.push(zone.file);
        }
    }

    function encodePath(path: string): string {
        return path.split('/').map(encodeURIComponent).join('/');
    }

    let completed = 0;
    const total = uniqueFiles.length;
    const loadedFiles = new Set<string>();

    const results = await Promise.allSettled(
        uniqueFiles.map(async (file) => {
            const url = `${basePath}/${encodePath(file)}`;
            try {
                const decoded = await fetchAndDecode(url);
                return { file, decoded };
            } finally {
                completed++;
                if (onProgress) {
                    onProgress(completed / total);
                }
            }
        })
    );

    // Decoding the (large) sample banks is where most time passes, so re-check
    // for supersession before streaming samples and the final zone map into the
    // worklet. Without this, a slow superseded load that already cleared zones
    // could still win by posting its stale map after the newer load's.
    if (signal?.aborted) {
        return;
    }

    for (const result of results) {
        if (result.status === 'rejected') {
            logger.warn('[Levain] Failed to load sample:', result.reason);
            continue;
        }
        const { file, decoded } = result.value;
        const sampleId = sampleIdMap.get(file);
        if (sampleId === undefined) {
            continue;
        }
        const transferable = decoded.data.buffer;
        nodePort.postMessage(
            {
                type: 'addSample',
                sampleId,
                data: decoded.data,
                frameCount: decoded.frameCount,
                channels: decoded.channels,
                sampleRate: decoded.sampleRate,
            },
            [transferable]
        );
        loadedFiles.add(file);
    }

    // Send zone definitions. Skip zones whose sample file failed to load
    // — we pre-assigned every file a sampleId, so we can't rely on the map
    // alone to detect failures anymore.
    let zoneId = 0;
    for (const { zone, artId } of allZones) {
        const sampleId = sampleIdMap.get(zone.file);
        if (sampleId === undefined || !loadedFiles.has(zone.file)) {
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
