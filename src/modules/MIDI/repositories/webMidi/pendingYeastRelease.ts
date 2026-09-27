type PendingRelease = {
    readonly routeId: string;
    readonly pitches: readonly number[];
    readonly retiredPitches: Set<number>;
};

const pendingByVoice = new Map<string, Set<PendingRelease>>();

function voiceKey(routeId: string, pitch: number): string {
    return `${routeId}:${pitch}`;
}

/** Keep a transformed old voice visible while its Note Off waits for Yeast. */
function beginPendingYeastRelease(routeId: string, pitches: readonly number[]): PendingRelease {
    const pending: PendingRelease = { routeId, pitches: [...new Set(pitches)], retiredPitches: new Set() };
    for (const pitch of pending.pitches) {
        const key = voiceKey(routeId, pitch);
        const releases = pendingByVoice.get(key) ?? new Set<PendingRelease>();
        releases.add(pending);
        pendingByVoice.set(key, releases);
    }
    return pending;
}

/** A successor must retire the older pitch voice before starting its own. */
function retirePendingYeastVoice(routeId: string, pitch: number, release: () => void): void {
    const key = voiceKey(routeId, pitch);
    const releases = pendingByVoice.get(key);
    if (!releases) {
        return;
    }
    for (const pending of releases) {
        if (pending.retiredPitches.has(pitch)) {
            continue;
        }
        release();
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

function finishPendingYeastRelease(pending: PendingRelease): void {
    for (const pitch of pending.pitches) {
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
    finish: finishPendingYeastRelease,
};
