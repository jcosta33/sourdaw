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
import { flushAutomergeStorageWrites } from '#/infra/store/storage/createAutomergeStorage';
import { type Store } from '#/infra/store/types';
import { trackStore } from '#/modules/Arrangement/stores';

import { type YeastState } from '../models/YeastState';

import { createYeastAutomergeStorage, defaultYeastState } from './yeastAutomergeStorage';

export type { YeastProcessorInfo, YeastProcessorType, YeastState } from '../models/YeastState';
export { LEGACY_SHARED_RACK_DEVICE_ID } from './yeastAutomergeStorage';

// Single source for the empty rack: the store seeds with it and the storage
// adapter projects it when the document has no `yeast` slot (audit CC-2).
const defaultState: YeastState = defaultYeastState;

/**
 * First Yeast device id in PROJECT ORDER — the instance a legacy shared rack
 * migrates to. Deliberately selection-independent: the adoption target is a
 * CRDT-side contract, and track selection is concurrently-editable state, so
 * two peers with divergent selections would each adopt the parked rack under
 * a different device id and the merged document would carry the rack twice —
 * the "exactly one device" invariant the storage adapter states. Project
 * order is identical on every peer, so concurrent adoptions collapse to one
 * key under merge.
 */
function firstYeastDeviceIdInProjectOrder(): string | null {
    return yeastDeviceIdsInProjectOrder()[0] ?? null;
}

/**
 * Device the store resolves when nothing is pinned: the selected track's
 * first Yeast device, then project order — a DISPLAY choice, so the panel
 * usually opens on what the musician sees selected. It must not be used for
 * legacy-rack adoption; that owner is
 * {@link firstYeastDeviceIdInProjectOrder}.
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

/**
 * Every Yeast device id in project order — the per-device write order the
 * flat project-file hydration uses, and the enumeration behind
 * {@link firstYeastDeviceIdInProjectOrder}.
 */
export function yeastDeviceIdsInProjectOrder(): string[] {
    const tracks = trackStore.value;
    if (!tracks) {
        return [];
    }
    const deviceIds: string[] = [];
    for (const track of tracks.tracks) {
        for (const device of track.devices) {
            if (device.type === 'yeast') {
                deviceIds.push(device.id);
            }
        }
    }
    return deviceIds;
}

/** The Yeast device a track's rack lives under — its first Yeast instance. */
function yeastDeviceIdForTrack(trackId: string): string | null {
    const tracks = trackStore.value;
    const track = tracks?.tracks.find((candidate) => candidate.id === trackId);
    const device = track?.devices.find((candidate) => candidate.type === 'yeast');
    return device?.id ?? null;
}

function readInitialYeastState(): YeastState | null {
    return null;
}

const localStateReader: { read: () => YeastState | null } = { read: readInitialYeastState };
const yeastStorageView = createYeastAutomergeStorage({
    getLocalState: (): YeastState | null => localStateReader.read(),
    getActiveDeviceId: activeYeastDeviceId,
    resolveFirstYeastDeviceId: firstYeastDeviceIdInProjectOrder,
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

/**
 * Every rack this session holds — the union the whole-project readers use
 * (groove-assignment reconcile), so a rack is never judged orphaned just
 * because its device is not the active one or lives only in a stored
 * arrangement. The active device's entry is its live view.
 */
export function readAllYeastRacks(): YeastState[] {
    return yeastStorageView.listRackDeviceIds().map((deviceId) => yeastStorageView.readRack(deviceId));
}

/**
 * The explicit device pin, `null` when the active rack resolves from
 * selection. Callers that temporarily pin another device (the runtime-status
 * publish) capture and restore this.
 */
export function getPinnedYeastDevice(): string | null {
    return explicitActiveDeviceId;
}

/**
 * One TRACK's rack: the rack of the Yeast device that lives on that track —
 * the per-instance read the offline render uses, because an offline render
 * processes every track and must run each one's notes through its own
 * device's processors. A track without a Yeast device renders through an
 * EMPTY rack (pass-through), never another device's rack.
 */
export function readYeastRackForTrack(trackId: string): YeastState {
    const deviceId = yeastDeviceIdForTrack(trackId);
    return deviceId !== null ? readYeastRack(deviceId) : defaultYeastState;
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
