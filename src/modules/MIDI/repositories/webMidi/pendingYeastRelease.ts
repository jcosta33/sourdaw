import type { GeneratedYeastVoice } from '../../models/WebMidiTypes';

type Release = (sampleFrame?: number, releaseVelocity?: number) => void;

type PendingVoice = {
    readonly owner: PendingRelease;
    readonly noteInstanceId: string | undefined;
    readonly pitch: number;
    readonly channel: number;
    readonly release: Release;
};

type PendingRelease = {
    readonly routeId: string;
    readonly trackId: string;
    readonly voices: Set<PendingVoice>;
};

const pendingByVoice = new Map<string, Set<PendingVoice>>();
const pendingByInstance = new Map<string, PendingVoice>();
const pendingReleases = new Set<PendingRelease>();

function voiceKey(routeId: string, channel: number, pitch: number): string {
    return `${routeId}:${channel}:${pitch}`;
}

function instanceKey(routeId: string, channel: number, noteInstanceId: string): string {
    return `${routeId}:${channel}:${noteInstanceId}`;
}

function addVoice(
    owner: PendingRelease,
    noteInstanceId: string | undefined,
    pitch: number,
    channel: number,
    release: Release
): void {
    const voice: PendingVoice = { owner, noteInstanceId, pitch, channel, release };
    owner.voices.add(voice);
    const key = voiceKey(owner.routeId, channel, pitch);
    const peers = pendingByVoice.get(key) ?? new Set<PendingVoice>();
    peers.add(voice);
    pendingByVoice.set(key, peers);
    if (noteInstanceId !== undefined) {
        pendingByInstance.set(instanceKey(owner.routeId, channel, noteInstanceId), voice);
    }
}

/** Keep transformed voices visible while their Note Off waits for Yeast. */
function beginPendingYeastRelease(
    routeId: string,
    releases: ReadonlyMap<number, Release>,
    generatedVoices: ReadonlyMap<string, GeneratedYeastVoice>,
    trackId: string,
    channel: number
): PendingRelease {
    const pending: PendingRelease = { routeId, trackId, voices: new Set() };
    for (const [pitch, release] of releases) {
        addVoice(pending, undefined, pitch, channel, release);
    }
    for (const [noteInstanceId, voice] of generatedVoices) {
        addVoice(pending, noteInstanceId, voice.pitch, voice.channel, voice.release);
    }
    if (pending.voices.size > 0) {
        pendingReleases.add(pending);
    }
    return pending;
}

function releaseVoice(voice: PendingVoice, sampleFrame?: number, releaseVelocity?: number): void {
    const { owner, channel, pitch, noteInstanceId } = voice;
    if (!owner.voices.delete(voice)) {
        return;
    }
    const key = voiceKey(owner.routeId, channel, pitch);
    const peers = pendingByVoice.get(key);
    peers?.delete(voice);
    if (peers?.size === 0) {
        pendingByVoice.delete(key);
    }
    if (noteInstanceId !== undefined) {
        const key = instanceKey(owner.routeId, channel, noteInstanceId);
        if (pendingByInstance.get(key) === voice) {
            pendingByInstance.delete(key);
        }
    }
    if (owner.voices.size === 0) {
        pendingReleases.delete(owner);
    }
    voice.release(sampleFrame, releaseVelocity);
}

/** A successor must retire the older pitch voice before starting its own. */
function retirePendingYeastVoice(routeId: string, channel: number, pitch: number, sampleFrame?: number): void {
    const peers = pendingByVoice.get(voiceKey(routeId, channel, pitch));
    if (!peers) {
        return;
    }
    for (const voice of [...peers]) {
        releaseVoice(voice, sampleFrame, 0);
    }
}

function wasPendingYeastVoiceRetired(pending: PendingRelease, pitch: number): boolean {
    return ![...pending.voices].some((voice) => voice.pitch === pitch);
}

function releasePendingYeastVoice(
    pending: PendingRelease,
    pitch: number,
    sampleFrame?: number,
    releaseVelocity?: number
): void {
    for (const voice of [...pending.voices]) {
        if (voice.noteInstanceId === undefined && voice.pitch === pitch) {
            releaseVoice(voice, sampleFrame, releaseVelocity);
        }
    }
}

type PendingYeastEvent = {
    routeId: string;
    trackId: string | undefined;
    noteInstanceId: string | undefined;
    channel: number;
    pitch: number;
    sampleFrame: number;
    releaseVelocity?: number;
};

function releasePendingYeastEvent(event: PendingYeastEvent): boolean {
    if (event.noteInstanceId === undefined) {
        return false;
    }
    const voice = pendingByInstance.get(instanceKey(event.routeId, event.channel, event.noteInstanceId));
    if (
        !voice ||
        (event.trackId !== undefined && voice.owner.trackId !== event.trackId) ||
        voice.pitch !== event.pitch
    ) {
        return false;
    }
    releaseVoice(voice, event.sampleFrame, event.releaseVelocity);
    return true;
}

function releaseAllPendingYeastVoices(pending: PendingRelease): void {
    for (const voice of [...pending.voices]) {
        releaseVoice(voice);
    }
}

function finishPendingYeastRelease(pending: PendingRelease): void {
    if (pending.voices.size === 0) {
        pendingReleases.delete(pending);
    }
}

function releaseAllPendingYeastReleases(): void {
    for (const pending of [...pendingReleases]) {
        releaseAllPendingYeastVoices(pending);
    }
}

export const pendingYeastRelease = {
    begin: beginPendingYeastRelease,
    retire: retirePendingYeastVoice,
    wasRetired: wasPendingYeastVoiceRetired,
    release: releasePendingYeastVoice,
    releaseEvent: releasePendingYeastEvent,
    releaseAll: releaseAllPendingYeastVoices,
    releaseAllPending: releaseAllPendingYeastReleases,
    finish: finishPendingYeastRelease,
};
