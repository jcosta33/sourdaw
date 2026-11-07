import { type Device } from '#/modules/Arrangement/stores';
import {
    compileLoadPresetActions,
    getAgentBuiltinDeviceFactoryManifest,
    getAgentPresetDiscoveryManifest,
} from '#/modules/Arrangement/useCases';
import { renderTrackSubgraphOffline } from '#/modules/AudioEngine/useCases';

import { createPresetPreviewProject } from './createPresetPreviewProject';

type Request = {
    presetId: string;
    sampleRate: number;
    signal: AbortSignal;
    isCurrent: () => boolean;
};
type CachedPreview = { buffer: AudioBuffer; bytes: number };
const completed = new Map<string, CachedPreview>();
const MAX_ENTRIES = 8;
const MAX_BYTES = 32 * 1024 * 1024;

function currentVersion(presetId: string): string | null {
    const entries = getAgentPresetDiscoveryManifest().filter((entry) => entry.id === presetId);
    return entries.length === 1 ? entries[0]!.version : null;
}

type Discovery = ReturnType<typeof getAgentPresetDiscoveryManifest>[number];
type Descriptor = ReturnType<typeof getAgentBuiltinDeviceFactoryManifest>[number];

function compilePreviewDevices(entry: Discovery): Device[] {
    const compiled = compileLoadPresetActions({ presetId: entry.id });
    if (!compiled) {
        throw new Error('Preset is unavailable');
    }
    const loads = compiled.actions.filter((action) => action.type === 'loadPreset');
    const creations = compiled.actions.filter((action) => action.type === 'addTrack');
    const load = loads.length === 1 ? loads[0] : undefined;
    const creation = creations.length === 1 ? creations[0] : undefined;
    if (
        !load ||
        !creation ||
        load.payload.presetId !== entry.id ||
        load.payload.trackId !== compiled.trackId ||
        creation.payload.id !== compiled.trackId ||
        creation.payload.kind !== entry.trackKind ||
        load.payload.devices.length === 0
    ) {
        throw new Error('Preset chain is incomplete');
    }
    return Array.from(structuredClone(load.payload.devices));
}

function supportedDescriptor(descriptors: readonly Descriptor[], type: string): Descriptor {
    const matches = descriptors.filter((descriptor) => descriptor.type === type);
    const descriptor = matches.length === 1 ? matches[0] : undefined;
    if (!descriptor || descriptor.availability !== 'available') {
        throw new Error(`Unsupported preview device: ${type}`);
    }
    return descriptor;
}

function countInstruments(devices: readonly Device[], descriptors: readonly Descriptor[]): number {
    let instruments = 0;
    for (const [index, device] of devices.entries()) {
        if (supportedDescriptor(descriptors, device.type).category === 'instrument') {
            instruments++;
            if (index !== 0 || device.bypassed) {
                throw new Error('Preset instrument cannot be auditioned');
            }
        }
    }
    return instruments;
}

function resolvePreviewDevices(presetId: string): Device[] {
    const entries = getAgentPresetDiscoveryManifest().filter((entry) => entry.id === presetId);
    const entry = entries.length === 1 ? entries[0] : undefined;
    if (!entry) {
        throw new Error('Preset is unavailable');
    }
    const devices = compilePreviewDevices(entry);
    const descriptors = getAgentBuiltinDeviceFactoryManifest([
        ...devices.map((device) => device.type),
        'builtin-synth',
    ]);
    const instruments = countInstruments(devices, descriptors);
    if (entry.trackKind === 'midi' && instruments === 1) {
        return devices;
    }
    if (entry.trackKind !== 'audio' || instruments !== 0 || entry.category !== 'fx') {
        throw new Error('Preset has no supported instrument');
    }
    if (supportedDescriptor(descriptors, 'builtin-synth').category !== 'instrument') {
        throw new Error('Preview excitation is unavailable');
    }
    return [
        { id: crypto.randomUUID(), type: 'builtin-synth', name: 'Synth', bypassed: false, parameterValues: {} },
        ...devices,
    ];
}

function validatePcm(buffer: AudioBuffer | null, sampleRate: number, durationSeconds: number): AudioBuffer {
    if (
        !buffer ||
        buffer.sampleRate !== sampleRate ||
        buffer.numberOfChannels !== 2 ||
        buffer.length !== Math.round(durationSeconds * sampleRate)
    ) {
        throw new Error('Preset render is incomplete');
    }
    let energy = 0;
    for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
        const samples = buffer.getChannelData(channel);
        if (samples.length !== buffer.length) {
            throw new Error('Preset render has incomplete channels');
        }
        for (const sample of samples) {
            if (!Number.isFinite(sample)) {
                throw new TypeError('Preset render has invalid audio');
            }
            energy += sample * sample;
        }
    }
    if (energy === 0) {
        throw new Error('Preset render is silent');
    }
    return buffer;
}

function remember(key: string, buffer: AudioBuffer): void {
    const bytes = buffer.length * buffer.numberOfChannels * Float32Array.BYTES_PER_ELEMENT;
    if (bytes > MAX_BYTES) {
        return;
    }
    completed.delete(key);
    completed.set(key, { buffer, bytes });
    let total = [...completed.values()].reduce((sum, entry) => sum + entry.bytes, 0);
    while (completed.size > MAX_ENTRIES || total > MAX_BYTES) {
        const oldest = completed.entries().next().value;
        if (!oldest) {
            break;
        }
        completed.delete(oldest[0]);
        total -= oldest[1].bytes;
    }
}

/** Resolve owner data without executing its actions, then render a disposable supplied project. */
export async function renderPresetPreview(request: Request) {
    const version = currentVersion(request.presetId);
    if (version === null) {
        throw new Error('Preset is unavailable');
    }
    const isCurrent = () =>
        !request.signal.aborted && request.isCurrent() && currentVersion(request.presetId) === version;
    if (!isCurrent()) {
        return null;
    }
    const key = JSON.stringify([request.presetId, version, request.sampleRate]);
    const hit = completed.get(key);
    if (hit) {
        completed.delete(key);
        completed.set(key, hit);
        return isCurrent() ? { buffer: hit.buffer, isCurrent } : null;
    }
    const preview = createPresetPreviewProject(resolvePreviewDevices(request.presetId));
    if (!isCurrent()) {
        return null;
    }
    const warnings: string[] = [];
    let scheduledNotes = 0;
    const buffer = await renderTrackSubgraphOffline({
        targetTrackId: preview.track.id,
        renderTracks: [preview.track],
        startBeat: preview.startBeat,
        endBeat: preview.endBeat,
        tailSeconds: preview.tailSeconds,
        includeInserts: true,
        includeAutomation: false,
        includeSends: false,
        targetMixer: 'keepLive',
        source: preview.source,
        abortSignal: request.signal,
        onWarning: (message) => {
            warnings.push(message);
        },
        onScheduled: (tally) => {
            scheduledNotes = tally.scheduledNotes;
            warnings.push(...tally.withheldDeviceTypes);
        },
    }).catch((error: unknown) => {
        if (!isCurrent()) {
            return null;
        }
        throw error;
    });
    if (!isCurrent()) {
        return null;
    }
    if (warnings.length > 0 || scheduledNotes !== 3) {
        throw new Error('Preset chain could not be rendered completely', { cause: warnings });
    }
    const pcm = validatePcm(buffer, request.sampleRate, preview.durationSeconds);
    if (!isCurrent()) {
        return null;
    }
    remember(key, pcm);
    return { buffer: pcm, isCurrent };
}
