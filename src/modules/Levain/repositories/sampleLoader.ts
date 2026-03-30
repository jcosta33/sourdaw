/**
 * Sample loading pipeline — fetches audio files, decodes to Float32,
 * and pushes into the WASM engine via LevainNode messages.
 *
 * Supports loading from:
 * - Individual audio files (WAV, FLAC, OGG)
 * - SFZ-style manifest files (JSON) that describe zone mappings
 *
 * For WASM: all samples must fit in memory. Enforce LOD strategies:
 * - Mic LOD (disable ambient mics first)
 * - Velocity layer LOD (reduce to 2-4)
 * - Round-robin LOD (reduce RR count)
 */

import { type ArticulationType } from '../models/LevainPatch';

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

export type ManifestArticulation = {
    type: ArticulationType;
    id: number;
    zones: ManifestZone[];
};

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

// ---------------------------------------------------------------------------
// LOD configuration
// ---------------------------------------------------------------------------

export type SampleLodConfig = {
    /** Maximum mic positions to load (0 = all). */
    maxMics: number;
    /** Maximum velocity layers per articulation (0 = all). */
    maxVelLayers: number;
    /** Maximum round-robin groups (0 = all). */
    maxRoundRobins: number;
    /** Disable legato transition samples. */
    disableTransitions: boolean;
};

export const DEFAULT_LOD: SampleLodConfig = {
    maxMics: 0,
    maxVelLayers: 0,
    maxRoundRobins: 0,
    disableTransitions: false,
};

export const WEB_LOD: SampleLodConfig = {
    maxMics: 2,
    maxVelLayers: 3,
    maxRoundRobins: 3,
    disableTransitions: false,
};

// ---------------------------------------------------------------------------
// Audio decoding
// ---------------------------------------------------------------------------

/**
 * Fetch and decode an audio file to Float32 PCM.
 * Returns { data, frameCount, channels, sampleRate }.
 * Uses a fresh OfflineAudioContext per decode to avoid state issues.
 */
// Use a single global context for decoding to avoid WKWebView context limits.
let decodeCtx: OfflineAudioContext | null = null;
function getDecodeContext(): OfflineAudioContext {
    if (!decodeCtx) {
        decodeCtx = new OfflineAudioContext(2, 44100, 44100);
    }
    return decodeCtx;
}

export async function fetchAndDecode(url: string): Promise<{
    data: Float32Array;
    frameCount: number;
    channels: number;
    sampleRate: number;
}> {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Failed to fetch sample: ${url} (${response.status})`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const ctx = getDecodeContext();
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer);

    const channels = audioBuffer.numberOfChannels;
    const frameCount = audioBuffer.length;
    const sampleRate = audioBuffer.sampleRate;

    // Interleave channels into a single Float32Array.
    const data = new Float32Array(frameCount * channels);
    for (let ch = 0; ch < channels; ch++) {
        const channelData = audioBuffer.getChannelData(ch);
        for (let i = 0; i < frameCount; i++) {
            data[i * channels + ch] = channelData[i] ?? 0;
        }
    }

    return { data, frameCount, channels, sampleRate };
}

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
    onProgress?: (progress: number) => void,
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
            [transferable],
        );

        sampleIdMap.set(zone.file, nextSampleId);
        nextSampleId++;
        loaded++;

        if (onProgress) {
            onProgress(loaded / total);
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

/**
 * Load a single sample for quick preview / audition.
 * Returns the sampleId assigned in the engine.
 */
export async function loadSingleSample(
    url: string,
    nodePort: MessagePort,
    sampleId: number,
): Promise<number> {
    const { data, frameCount, channels, sampleRate } = await fetchAndDecode(url);

    const transferable = data.buffer;
    nodePort.postMessage(
        {
            type: 'addSample',
            sampleId,
            data,
            frameCount,
            channels,
            sampleRate,
        },
        [transferable],
    );

    return sampleId;
}
