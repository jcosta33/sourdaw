/**
 * Yeast store — the serializable projection used by the UI and use cases.
 *
 * Worker handles, racks, and processor instances live in the engine
 * runtime. This store never holds those handles or executes MIDI processing.
 *
 * Rack state is scoped per device instance (issue #2422): the CRDT slot holds
 * one rack per Yeast device id, and this store's `YeastState` is the ACTIVE
 * device's rack. The panel sets the active device when it opens; with no
 * explicit device the active rack resolves to the first Yeast device in the
 * project (the same instance a legacy shared rack migrates to), so every
 * use case that reads and writes `yeastStore` edits exactly one device's
 * rack.
 */

import { createStore } from '#/infra/store/createStore';
import { type Store } from '#/infra/store/types';
import { flushAutomergeStorageWrites } from '#/infra/store/storage/createAutomergeStorage';
import { trackStore } from '#/modules/Arrangement/stores';

import { type YeastState } from '../models/YeastState';

import { createYeastAutomergeStorage, defaultYeastState } from './yeastAutomergeStorage';

export type { YeastProcessorInfo, YeastProcessorType, YeastState } from '../models/YeastState';

// Single source for the empty rack: the store seeds with it and the storage
// adapter projects it when the document has no `yeast` slot (audit CC-2).
const defaultState: YeastState = defaultYeastState;

/**
 * First Yeast device id in the project — the instance that owns a legacy
 * shared rack. The selected track's first Yeast device wins, then project
 * order: the migration target should follow what the musician sees selected,
 * while staying a deterministic single instance.
 */
function firstYeastDeviceId(): string | null {
    const tracks = trackStore.value;
    if (!tracks) {
        return null;
    }
    const ordered = tracks.selectedTrackId
        ? [
              ...tracks.tracks.filter((track) => track.id === tracks.selectedTrackId),
              ...tracks.tracks.filter((track) => track.id !== tracks.selectedTrackId),
          ]
        : tracks.tracks;
    for (const track of ordered) {
        const device = track.devices.find((candidate) => candidate.type === 'yeast');
        if (device) {
            return device.id;
        }
    }
    return null;
}

/** Device the panel pinned, if any; `null` means resolve from the project. */
let explicitActiveDeviceId: string | null = null;

function activeYeastDeviceId(): string | null {
    return explicitActiveDeviceId ?? firstYeastDeviceId();
}

function readInitialYeastState(): YeastState | null {
    return null;
}

const localStateReader: { read: () => YeastState | null } = { read: readInitialYeastState };
const yeastStorageView = createYeastAutomergeStorage({
    getLocalState: (): YeastState | null => localStateReader.read(),
    getActiveDeviceId: activeYeastDeviceId,
    resolveFirstYeastDeviceId: firstYeastDeviceId,
});

export const yeastStore: Store<YeastState> = createStore<YeastState>({
    storage: yeastStorageView.storage,
    initialData: defaultState,
});

function readCurrentYeastState(): YeastState | null {
    return yeastStore.value;
}

localStateReader.read = readCurrentYeastState;

/**
 * Land any still-pending rack write under the device it was authored for
 * BEFORE the active device can move. The storage layer's device-switch
 * projection replaces a visible pending write's value (its sanitizer
 * contract), so an unflushed edit would be silently reverted — or flushed
 * under the wrong device's key. The global flush skips writes owned by open
 * action transactions, and every rack-editing use case runs inside one, so
 * this only ever lands rAF-deferred unscoped writes. The one residual window
 * — an unscoped rack write pending while NO panel pins a device and the
 * project-order resolution changes in the same frame — has no writer in
 * production: rack edits come from the pinned panel or scoped transactions.
 */
function flushPendingRackWrites(): void {
    flushAutomergeStorageWrites();
}

/**
 * Pin which device's rack the store reflects (the panel does this on open,
 * and clears it on close). No-ops when the resolved view is unchanged.
 */
export function setActiveYeastDevice(deviceId: string | null): void {
    flushPendingRackWrites();
    explicitActiveDeviceId = deviceId;
    yeastStorageView.setActiveDevice(activeYeastDeviceId());
}

/**
 * One device's rack, independent of the active device — the per-instance read
 * the audio scheduling paths use so each rack processes its own processors.
 */
export function readYeastRack(deviceId: string): YeastState {
    return yeastStorageView.readRack(deviceId);
}

// Device identity lives in the tracks slot: when it changes (a Yeast device
// added or removed, selection moved), the active rack re-resolves so the
// store never keeps showing a rack whose device no longer exists — and a
// newly added first device immediately adopts a parked legacy rack. Pending
// writes land first, under the device they were authored for.
trackStore.subscribe(() => {
    flushPendingRackWrites();
    yeastStorageView.setActiveDevice(activeYeastDeviceId());
});
