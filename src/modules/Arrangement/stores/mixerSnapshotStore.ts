/**
 * Mixer snapshot store — named per-channel gain/pan/mute/solo captures a user
 * explicitly saves for later recall.
 *
 * F6 — previously a bare `createStore({ initialData })` with no storage
 * adapter, so every saved snapshot vanished on reload. Backed by the same
 * `createStore` + `createAutomergeStorage` pattern #982 used for gain
 * envelopes and VCA groups: this is durable project data the user asked to
 * keep, not session-only scratch state.
 */
import { createStore } from '#/infra/store/createStore';
import { createAutomergeStorage } from '#/infra/store/storage/createAutomergeStorage';
import { type Store } from '#/infra/store/types';

import { type MixerChannelSnapshot, type MixerSnapshot } from '../models/MixerSnapshotTypes';

const DOC_PREFIX_ROOT = 'root';

export type MixerSnapshotState = {
    snapshots: MixerSnapshot[];
};

export const defaultMixerSnapshotState: MixerSnapshotState = { snapshots: [] };

function isMixerChannelSnapshot(value: unknown): value is MixerChannelSnapshot {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        return false;
    }
    if (!('trackId' in value) || typeof value.trackId !== 'string' || value.trackId.length === 0) {
        return false;
    }
    if (!('gain' in value) || typeof value.gain !== 'number' || !Number.isFinite(value.gain)) {
        return false;
    }
    if (!('pan' in value) || typeof value.pan !== 'number' || !Number.isFinite(value.pan)) {
        return false;
    }
    if (!('muted' in value) || typeof value.muted !== 'boolean') {
        return false;
    }
    return 'soloed' in value && typeof value.soloed === 'boolean';
}

function isMixerSnapshot(value: unknown): value is MixerSnapshot {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        return false;
    }
    if (!('id' in value) || typeof value.id !== 'string' || value.id.length === 0) {
        return false;
    }
    if (!('name' in value) || typeof value.name !== 'string') {
        return false;
    }
    if (!('createdAt' in value) || typeof value.createdAt !== 'number' || !Number.isFinite(value.createdAt)) {
        return false;
    }
    if (!('channels' in value) || !Array.isArray(value.channels)) {
        return false;
    }
    return value.channels.every(isMixerChannelSnapshot);
}

const MIXER_CHANNEL_SNAPSHOT_KEYS = ['trackId', 'gain', 'pan', 'muted', 'soloed'] as const;
const MIXER_SNAPSHOT_KEYS = ['id', 'name', 'createdAt', 'channels'] as const;

/**
 * Decode persisted mixer snapshots from a project file or from the
 * `mixerSnapshots` document slot — one decoder, so the two load paths cannot
 * drift. A snapshot that does not decode is dropped rather than repaired: a
 * partially-corrupt snapshot would recall wrong levels on some channels,
 * which is worse than the snapshot simply not existing. Duplicated ids keep
 * the first occurrence.
 */
export function sanitizeMixerSnapshots(value: unknown): MixerSnapshot[] {
    if (!Array.isArray(value)) {
        return [];
    }

    const snapshots: MixerSnapshot[] = [];
    const seenIds = new Set<string>();
    for (const candidate of value) {
        if (!isMixerSnapshot(candidate) || seenIds.has(candidate.id)) {
            continue;
        }
        seenIds.add(candidate.id);
        snapshots.push({
            id: candidate.id,
            name: candidate.name,
            createdAt: candidate.createdAt,
            channels: candidate.channels.map((channel) => ({
                trackId: channel.trackId,
                gain: channel.gain,
                pan: channel.pan,
                muted: channel.muted,
                soloed: channel.soloed,
            })),
        });
    }
    return snapshots;
}

function isExactMixerSnapshotState(value: unknown): value is MixerSnapshotState {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        return false;
    }
    const keys = Object.keys(value);
    if (keys.length !== 1 || keys[0] !== 'snapshots') {
        return false;
    }
    if (!('snapshots' in value) || !Array.isArray(value.snapshots)) {
        return false;
    }

    const seenIds = new Set<string>();
    for (const candidate of value.snapshots) {
        if (!isMixerSnapshot(candidate) || seenIds.has(candidate.id)) {
            return false;
        }
        if (Object.keys(candidate).length !== MIXER_SNAPSHOT_KEYS.length) {
            return false;
        }
        if (candidate.channels.some((channel) => Object.keys(channel).length !== MIXER_CHANNEL_SNAPSHOT_KEYS.length)) {
            return false;
        }
        seenIds.add(candidate.id);
    }
    return true;
}

/**
 * Store-shaped decoder for the `mixerSnapshots` document slot.
 *
 * Returns the argument itself when it already decodes exactly, so `createStore`
 * sees an identical value and does not write a sanitized copy back over a
 * shared document.
 */
function sanitizeMixerSnapshotState(value: unknown): MixerSnapshotState {
    if (isExactMixerSnapshotState(value)) {
        return value;
    }
    if (value === null || typeof value !== 'object' || Array.isArray(value) || !('snapshots' in value)) {
        return { snapshots: [] };
    }
    return { snapshots: sanitizeMixerSnapshots(value.snapshots) };
}

export const mixerSnapshotStore: Store<MixerSnapshotState> = createStore<MixerSnapshotState>({
    storage: createAutomergeStorage<MixerSnapshotState>(DOC_PREFIX_ROOT, 'mixerSnapshots', {
        // A document without the `mixerSnapshots` slot resets the store to
        // empty rather than back-writing this replica's cache (audit CC-2) —
        // otherwise the outgoing project's saved snapshots would leak into an
        // incoming project that never saved any.
        hydrateMissing: () => ({ snapshots: [] }),
    }),
    initialData: defaultMixerSnapshotState,
    sanitize: sanitizeMixerSnapshotState,
});
