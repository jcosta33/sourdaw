type FreezeSnapshot = {
    readonly frozen: boolean;
    readonly frozenBufferId?: string;
    readonly freezeState: {
        readonly status: 'unfrozen' | 'freezing' | 'frozen' | 'stale' | 'error';
        readonly freezeId?: string;
        readonly frozenBufferId?: string;
        readonly frozenAudioHash?: string;
        readonly sourceContentHash?: string;
        readonly deviceChainHash?: string;
        readonly renderSettings?: {
            readonly sampleRate: number;
            readonly bitDepth: number;
            readonly channelCount: number;
            readonly tailLengthSeconds: number;
            readonly bakeVersion?: number;
        };
        readonly compensationSeconds?: number;
        readonly renderProgress?: number;
        readonly errorMessage?: string;
        readonly renderedAt?: number;
    };
};

/**
 * The state a track shows when a freeze that was `freezing` is known not to be running. A freeze
 * only writes `frozen` and `frozenBufferId` when it commits, so a track still carrying a take was
 * refreshing a stale one: the take is settled but its content was never confirmed current, which is
 * `stale`. A track without a take settles to `unfrozen`. Any other status is returned unchanged.
 * Absent fields stay absent rather than becoming `undefined`, because snapshots are compared by value.
 */
export function settleFreezingSnapshot(snapshot: FreezeSnapshot): FreezeSnapshot {
    if (snapshot.freezeState.status !== 'freezing') {
        return snapshot;
    }
    if (snapshot.frozen && snapshot.frozenBufferId !== undefined) {
        const { renderProgress: _runningProgress, ...freezeState } = snapshot.freezeState;
        return { ...snapshot, freezeState: { ...freezeState, status: 'stale' } };
    }
    return { frozen: false, freezeState: { status: 'unfrozen' } };
}
