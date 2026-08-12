import { describe, it, expect, beforeEach } from 'vitest';

import { mixerSnapshotStore, sanitizeMixerSnapshots, type MixerSnapshotState } from '../mixerSnapshotStore';

function makeSnapshot(id: string): MixerSnapshotState['snapshots'][number] {
    return {
        id,
        name: `Snapshot ${id}`,
        createdAt: 1000,
        channels: [{ trackId: 't1', gain: 0.8, pan: 0, muted: false, soloed: false }],
    };
}

// F6 — mixerSnapshotStore used to be memory-only; every saved snapshot
// vanished on reload. Now backed by `createAutomergeStorage`, so this suite
// covers the decode contract that hydration relies on.
describe('mixerSnapshotStore', () => {
    beforeEach(() => {
        mixerSnapshotStore.set({ snapshots: [] });
    });

    it('boots empty', () => {
        expect(mixerSnapshotStore.value?.snapshots).toEqual([]);
    });

    it('stores and replaces snapshots', () => {
        mixerSnapshotStore.set({ snapshots: [makeSnapshot('s1')] });
        expect(mixerSnapshotStore.value?.snapshots).toHaveLength(1);

        mixerSnapshotStore.set({ snapshots: [makeSnapshot('s2'), makeSnapshot('s3')] });
        expect(mixerSnapshotStore.value?.snapshots.map((snapshot) => snapshot.id)).toEqual(['s2', 's3']);
    });

    it('subscribers fire on set', () => {
        let called = false;
        const unsubscribe = mixerSnapshotStore.subscribe(() => {
            called = true;
        });
        mixerSnapshotStore.set({ snapshots: [makeSnapshot('s1')] });
        expect(called).toBe(true);
        unsubscribe();
    });

    describe('sanitizeMixerSnapshots', () => {
        it('keeps a well-formed persisted snapshot and copies its channels', () => {
            const persisted = [makeSnapshot('s1')];

            const decoded = sanitizeMixerSnapshots(persisted);

            expect(decoded).toEqual(persisted);
            expect(decoded[0]?.channels).not.toBe(persisted[0]?.channels);
        });

        it('drops rows that cannot drive a mixer channel and keeps the ones that can', () => {
            const decoded = sanitizeMixerSnapshots([
                { id: '', name: 'No id', createdAt: 1, channels: [] },
                {
                    id: 's-bad-channel',
                    name: 'Bad channel',
                    createdAt: 1,
                    channels: [{ trackId: 't1', gain: Number.NaN, pan: 0, muted: false, soloed: false }],
                },
                makeSnapshot('s-ok'),
                { ...makeSnapshot('s-ok'), name: 'Duplicate' },
            ]);

            expect(decoded.map((snapshot) => snapshot.id)).toEqual(['s-ok']);
        });

        it('decodes a non-array to no snapshots', () => {
            expect(sanitizeMixerSnapshots(undefined)).toEqual([]);
            expect(sanitizeMixerSnapshots({ snapshots: [] })).toEqual([]);
        });
    });
});
