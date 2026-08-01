import { decodedBankResource } from './decodedBankResource';
import { type SampleLodConfig } from './helpers';

import type { DecodedBank } from './createDecodedBankResource';

export type { ManifestArticulation, ManifestZone, SampleManifest } from './sampleManifest';

export const DEFAULT_LOD: SampleLodConfig = {
    maxMics: 0,
    maxRoundRobins: 0,
};

export type LoadInstrumentFromManifestInput = {
    manifestUrl: string;
    basePath: string;
    expectedInstrumentId: string;
    nodePort: MessagePort;
    lod?: SampleLodConfig;
    onProgress?: (progress: number) => void;
    signal?: AbortSignal;
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
export async function loadInstrumentFromManifest({
    manifestUrl,
    basePath,
    expectedInstrumentId,
    nodePort,
    lod = DEFAULT_LOD,
    onProgress,
    signal,
}: LoadInstrumentFromManifestInput): Promise<void> {
    let bank: DecodedBank;
    try {
        bank = await decodedBankResource.load({
            manifestUrl,
            basePath,
            expectedInstrumentId,
            lod,
            onProgress,
            signal,
        });
    } catch (error) {
        if (signal?.aborted) {
            return;
        }
        throw error;
    }
    if (signal?.aborted) {
        return;
    }

    nodePort.postMessage({ type: 'clearZones' });

    const sampleIdMap = new Map<string, number>();
    for (const [sampleId, file] of bank.files.entries()) {
        const decoded = bank.samples.get(file);
        if (!decoded) {
            throw new Error(`Decoded Levain bank ${bank.instrumentId}@${bank.version} is missing ${file}`);
        }
        sampleIdMap.set(file, sampleId);
        nodePort.postMessage({
            type: 'addSample',
            sampleId,
            data: decoded.data,
            frameCount: decoded.frameCount,
            channels: decoded.channels,
            sampleRate: decoded.sampleRate,
        });
    }

    let zoneId = 0;
    for (const { zone, articulationId } of bank.zones) {
        const sampleId = sampleIdMap.get(zone.file);
        if (sampleId === undefined) {
            throw new Error(`Decoded Levain bank ${bank.instrumentId}@${bank.version} has no id for ${zone.file}`);
        }

        nodePort.postMessage({
            type: 'addZone',
            zoneId,
            sampleId,
            articulationId,
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
        numArticulations: bank.numArticulations,
        numMics: bank.numMics,
    });
}
