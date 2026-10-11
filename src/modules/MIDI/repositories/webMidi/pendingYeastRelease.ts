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
// Track-scoped instance index for lifecycle note-offs (#4873): the rack's
// retirement offs name (track, channel, instance) but the route a voice was
// registered under can outlive the yeast device id it was keyed with, so the
// captured owner must be reachable without reconstructing that route id.
const pendingByInstanceOnTrack = new Map<string, PendingVoice>();
const pendingReleases = new Set<PendingRelease>();

function voiceKey(routeId: string, channel: number, pitch: number): string {
    return `${routeId}:${channel}:${pitch}`;
}

function instanceKey(routeId: string, channel: number, noteInstanceId: string): string {
    return `${routeId}:${channel}:${noteInstanceId}`;
}

function instanceOnTrackKey(trackId: string, channel: number, noteInstanceId: string): string {
    return `${trackId}:${channel}:${noteInstanceId}`;
}

function forgetInstanceIndexes(voice: PendingVoice): void {
    const { owner, channel, noteInstanceId } = voice;
    if (noteInstanceId === undefined) {
        return;
    }
    const routeKey = instanceKey(owner.routeId, channel, noteInstanceId);
    if (pendingByInstance.get(routeKey) === voice) {
        pendingByInstance.delete(routeKey);
    }
    const trackKey = instanceOnTrackKey(owner.trackId, channel, noteInstanceId);
    if (pendingByInstanceOnTrack.get(trackKey) === voice) {
        pendingByInstanceOnTrack.delete(trackKey);
    }
}

/**
 * Remove a voice's registry entry without releasing it: only the handle
 * moves, the voice itself keeps sounding.
 */
function detachVoice(voice: PendingVoice): void {
    if (!voice.owner.voices.delete(voice)) {
        return;
    }
    const key = voiceKey(voice.owner.routeId, voice.channel, voice.pitch);
    const peers = pendingByVoice.get(key);
    peers?.delete(voice);
    if (peers?.size === 0) {
        pendingByVoice.delete(key);
    }
    forgetInstanceIndexes(voice);
    if (voice.owner.voices.size === 0) {
        pendingReleases.delete(voice.owner);
    }
}

function addVoice(
    owner: PendingRelease,
    noteInstanceId: string | undefined,
    pitch: number,
    channel: number,
    release: Release
): void {
    if (noteInstanceId !== undefined) {
        // One live registration per generated voice identity: a later
        // registration of the same instance id replaces the earlier entry
        // without releasing it, so the voice can never be released twice
        // through two entries.
        const existing = pendingByInstance.get(instanceKey(owner.routeId, channel, noteInstanceId));
        if (existing) {
            detachVoice(existing);
        }
    }
    const voice: PendingVoice = { owner, noteInstanceId, pitch, channel, release };
    owner.voices.add(voice);
    const key = voiceKey(owner.routeId, channel, pitch);
    const peers = pendingByVoice.get(key) ?? new Set<PendingVoice>();
    peers.add(voice);
    pendingByVoice.set(key, peers);
    if (noteInstanceId !== undefined) {
        pendingByInstance.set(instanceKey(owner.routeId, channel, noteInstanceId), voice);
        pendingByInstanceOnTrack.set(instanceOnTrackKey(owner.trackId, channel, noteInstanceId), voice);
    }
}

/**
 * Keep transformed voices visible while their Note Off waits for Yeast. A
 * voice registered at its note's release snapshots the note's own pitch-keyed
 * step releases; generated voices live here from the moment they start
 * sounding (`registerVoice`), so this snapshot never sees one twice.
 */
function beginPendingYeastRelease(
    routeId: string,
    releases: ReadonlyMap<number, Release>,
    trackId: string,
    channel: number
): PendingRelease {
    const pending: PendingRelease = { routeId, trackId, voices: new Set() };
    for (const [pitch, release] of releases) {
        addVoice(pending, undefined, pitch, channel, release);
    }
    if (pending.voices.size > 0) {
        pendingReleases.add(pending);
    }
    return pending;
}

function releaseVoice(voice: PendingVoice, sampleFrame?: number, releaseVelocity?: number): void {
    const { owner, channel, pitch } = voice;
    if (!owner.voices.delete(voice)) {
        return;
    }
    const key = voiceKey(owner.routeId, channel, pitch);
    const peers = pendingByVoice.get(key);
    peers?.delete(voice);
    if (peers?.size === 0) {
        pendingByVoice.delete(key);
    }
    forgetInstanceIndexes(voice);
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

/**
 * Register a generated voice at the moment it starts sounding, not at its
 * source note's release (#4870). The registry is keyed per route, so any
 * session's drain can release a voice another session started, and a reset
 * still reaches the voice through `releaseAllPending` — an owner that lives
 * only as long as the voice does.
 */
function registerStartedYeastVoice(
    routeId: string,
    trackId: string,
    noteInstanceId: string,
    pitch: number,
    channel: number,
    release: Release
): void {
    const owner: PendingRelease = { routeId, trackId, voices: new Set() };
    addVoice(owner, noteInstanceId, pitch, channel, release);
    pendingReleases.add(owner);
}

/**
 * Keep a voice a release session started with no note instance of its own on
 * that session's pending release: the key it belongs to is already up, so the
 * session's source-pitch note-off, a route release, and a reset reach it only
 * here.
 */
function addPendingYeastSourceVoice(pending: PendingRelease, pitch: number, channel: number, release: Release): void {
    addVoice(pending, undefined, pitch, channel, release);
    pendingReleases.add(pending);
}

/**
 * Release every voice still registered on a route, whichever session started
 * it: the route's Yeast is gone and no key that went through it is held, so no
 * rack is left to send those voices their note-offs.
 */
function releaseYeastRoute(routeId: string, sampleFrame: number, releaseVelocity: number): void {
    for (const pending of [...pendingReleases]) {
        if (pending.routeId !== routeId) {
            continue;
        }
        for (const voice of [...pending.voices]) {
            releaseVoice(voice, sampleFrame, releaseVelocity);
        }
    }
}

/**
 * Release every voice registered for an instrument track at one channel and
 * pitch, whichever of the track's routes and sessions holds it, through the
 * release its note-on captured.
 */
function releaseYeastTrackPitch(
    trackId: string,
    channel: number,
    pitch: number,
    sampleFrame?: number,
    releaseVelocity?: number
): void {
    for (const pending of [...pendingReleases]) {
        if (pending.trackId !== trackId) {
            continue;
        }
        for (const voice of [...pending.voices]) {
            if (voice.channel === channel && voice.pitch === pitch) {
                releaseVoice(voice, sampleFrame, releaseVelocity);
            }
        }
    }
}

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

type CapturedLifecycleEvent = {
    trackId: string;
    channel: number;
    pitch: number;
    noteInstanceId: string | undefined;
    sampleFrame?: number;
    releaseVelocity?: number;
};

/**
 * Release the captured owner behind a lifecycle note-off the Worker rack
 * emitted while retiring (#4873). Instance-keyed offs resolve through the
 * track-scoped registry index, so the ORIGINAL instrument control releases
 * even after the track's instrument changed. Identityless offs resolve the
 * pending pitch-keyed captures the same track registered. False means no
 * captured owner claims the off: instance-keyed callers treat that as a
 * repeat and drop it, identityless callers fall back to the current-node
 * route.
 */
function releaseCapturedLifecycleVoice(event: CapturedLifecycleEvent): boolean {
    if (event.noteInstanceId !== undefined) {
        const voice = pendingByInstanceOnTrack.get(
            instanceOnTrackKey(event.trackId, event.channel, event.noteInstanceId)
        );
        if (!voice || voice.pitch !== event.pitch) {
            return false;
        }
        releaseVoice(voice, event.sampleFrame, event.releaseVelocity);
        return true;
    }
    for (const owner of pendingReleases) {
        if (owner.trackId !== event.trackId) {
            continue;
        }
        for (const voice of [...owner.voices]) {
            if (voice.noteInstanceId !== undefined || voice.channel !== event.channel || voice.pitch !== event.pitch) {
                continue;
            }
            releaseVoice(voice, event.sampleFrame, event.releaseVelocity);
            return true;
        }
    }
    return false;
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
    registerVoice: registerStartedYeastVoice,
    addSourceVoice: addPendingYeastSourceVoice,
    releaseRoute: releaseYeastRoute,
    releaseTrackPitch: releaseYeastTrackPitch,
    retire: retirePendingYeastVoice,
    wasRetired: wasPendingYeastVoiceRetired,
    release: releasePendingYeastVoice,
    releaseEvent: releasePendingYeastEvent,
    releaseLifecycleVoice: releaseCapturedLifecycleVoice,
    releaseAll: releaseAllPendingYeastVoices,
    releaseAllPending: releaseAllPendingYeastReleases,
    finish: finishPendingYeastRelease,
};
