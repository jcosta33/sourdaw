type PendingRelease = {
    readonly routeId: string;
    readonly noteInstanceId: string | undefined;
    readonly trackId: string;
    readonly channel: number;
    readonly releases: ReadonlyMap<number, (sampleFrame?: number, releaseVelocity?: number) => void>;
    readonly retiredPitches: Set<number>;
};

const pendingByVoice = new Map<string, Set<PendingRelease>>();
const pendingByInstance = new Map<string, PendingRelease>();
const pendingReleases = new Set<PendingRelease>();

function voiceKey(routeId: string, channel: number, pitch: number): string {
    return `${routeId}:${channel}:${pitch}`;
}

/** Keep a transformed old voice visible while its Note Off waits for Yeast. */
function beginPendingYeastRelease(
    routeId: string,
    releases: ReadonlyMap<number, (sampleFrame?: number, releaseVelocity?: number) => void>,
    noteInstanceId: string | undefined,
    trackId: string,
    channel: number
): PendingRelease {
    const pending: PendingRelease = {
        routeId,
        noteInstanceId,
        trackId,
        channel,
        releases: new Map(releases),
        retiredPitches: new Set(),
    };
    pendingReleases.add(pending);
    if (noteInstanceId !== undefined) {
        pendingByInstance.set(noteInstanceId, pending);
    }
    for (const pitch of pending.releases.keys()) {
        const key = voiceKey(routeId, channel, pitch);
        const releases = pendingByVoice.get(key) ?? new Set<PendingRelease>();
        releases.add(pending);
        pendingByVoice.set(key, releases);
    }
    return pending;
}

/** A successor must retire the older pitch voice before starting its own. */
function retirePendingYeastVoice(routeId: string, channel: number, pitch: number, sampleFrame?: number): void {
    const key = voiceKey(routeId, channel, pitch);
    const releases = pendingByVoice.get(key);
    if (!releases) {
        return;
    }
    for (const pending of releases) {
        if (pending.retiredPitches.has(pitch)) {
            continue;
        }
        pending.releases.get(pitch)?.(sampleFrame, 0);
        pending.retiredPitches.add(pitch);
        releases.delete(pending);
        finishPendingYeastRelease(pending);
    }
    if (releases.size === 0) {
        pendingByVoice.delete(key);
    }
}

function wasPendingYeastVoiceRetired(pending: PendingRelease, pitch: number): boolean {
    return pending.retiredPitches.has(pitch);
}

function releasePendingYeastVoice(
    pending: PendingRelease,
    pitch: number,
    sampleFrame?: number,
    releaseVelocity?: number
): void {
    if (pending.retiredPitches.has(pitch)) {
        return;
    }
    const release = pending.releases.get(pitch);
    release?.(sampleFrame, releaseVelocity);
    if (release) {
        pending.retiredPitches.add(pitch);
        const key = voiceKey(pending.routeId, pending.channel, pitch);
        const peers = pendingByVoice.get(key);
        peers?.delete(pending);
        if (peers?.size === 0) {
            pendingByVoice.delete(key);
        }
        finishPendingYeastRelease(pending);
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
    const pending = pendingByInstance.get(event.noteInstanceId);
    if (
        !pending ||
        pending.routeId !== event.routeId ||
        pending.channel !== event.channel ||
        (event.trackId !== undefined && pending.trackId !== event.trackId) ||
        !pending.releases.has(event.pitch)
    ) {
        return false;
    }
    releasePendingYeastVoice(pending, event.pitch, event.sampleFrame, event.releaseVelocity);
    return true;
}

function releaseAllPendingYeastVoices(pending: PendingRelease): void {
    for (const pitch of pending.releases.keys()) {
        releasePendingYeastVoice(pending, pitch);
    }
}

function finishPendingYeastRelease(pending: PendingRelease): void {
    if (pending.retiredPitches.size !== pending.releases.size) {
        return;
    }
    if (pending.noteInstanceId !== undefined && pendingByInstance.get(pending.noteInstanceId) === pending) {
        pendingByInstance.delete(pending.noteInstanceId);
    }
    pendingReleases.delete(pending);
    for (const pitch of pending.releases.keys()) {
        const key = voiceKey(pending.routeId, pending.channel, pitch);
        const releases = pendingByVoice.get(key);
        releases?.delete(pending);
        if (releases?.size === 0) {
            pendingByVoice.delete(key);
        }
    }
}

function releaseAllPendingYeastReleases(): void {
    for (const pending of [...pendingReleases]) {
        releaseAllPendingYeastVoices(pending);
        finishPendingYeastRelease(pending);
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
