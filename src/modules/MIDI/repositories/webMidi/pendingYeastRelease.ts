type PendingRelease = {
    readonly routeId: string;
    readonly releases: ReadonlyMap<number, (sampleFrame?: number, releaseVelocity?: number) => void>;
    readonly retiredPitches: Set<number>;
};

const pendingByVoice = new Map<string, Set<PendingRelease>>();

function voiceKey(routeId: string, pitch: number): string {
    return `${routeId}:${pitch}`;
}

/** Keep a transformed old voice visible while its Note Off waits for Yeast. */
function beginPendingYeastRelease(
    routeId: string,
    releases: ReadonlyMap<number, (sampleFrame?: number, releaseVelocity?: number) => void>
): PendingRelease {
    const pending: PendingRelease = { routeId, releases: new Map(releases), retiredPitches: new Set() };
    for (const pitch of pending.releases.keys()) {
        const key = voiceKey(routeId, pitch);
        const releases = pendingByVoice.get(key) ?? new Set<PendingRelease>();
        releases.add(pending);
        pendingByVoice.set(key, releases);
    }
    return pending;
}

/** A successor must retire the older pitch voice before starting its own. */
function retirePendingYeastVoice(routeId: string, pitch: number, sampleFrame?: number): void {
    const key = voiceKey(routeId, pitch);
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
    }
}

function releaseAllPendingYeastVoices(pending: PendingRelease): void {
    for (const pitch of pending.releases.keys()) {
        releasePendingYeastVoice(pending, pitch);
    }
}

function finishPendingYeastRelease(pending: PendingRelease): void {
    for (const pitch of pending.releases.keys()) {
        const key = voiceKey(pending.routeId, pitch);
        const releases = pendingByVoice.get(key);
        releases?.delete(pending);
        if (releases?.size === 0) {
            pendingByVoice.delete(key);
        }
    }
}

export const pendingYeastRelease = {
    begin: beginPendingYeastRelease,
    retire: retirePendingYeastVoice,
    wasRetired: wasPendingYeastVoiceRetired,
    release: releasePendingYeastVoice,
    releaseAll: releaseAllPendingYeastVoices,
    finish: finishPendingYeastRelease,
};
