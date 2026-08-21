import { change, from, type Doc } from '@automerge/automerge';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { createTrack } from '#/modules/Arrangement/useCases';
import { defaultTrackState, trackStore } from '#/modules/Arrangement/stores';

import {
    createDefaultPattern,
    decodeArpPatternParams,
    defaultStep,
    DEFAULT_ARP_PATTERN_LENGTH,
    withArpPatternParams,
} from '../../models/ArpPattern';
import { hydrateYeastState } from '../../useCases/hydrateYeastState';
import { readYeastRack, setActiveYeastDevice, yeastStore, type YeastProcessorInfo } from '../yeastStore';

// Rack state is scoped per device instance (issue #2422): every write below
// lands in `racks[DEVICE_ID]`, and the active device resolves through the
// project's tracks exactly as production does.
const DEVICE_ID = 'device-a';
const SECOND_DEVICE_ID = 'device-b';

function yeastDevice(deviceId: string): {
    id: string;
    name: string;
    type: 'yeast';
    bypassed: boolean;
    parameterValues: Record<string, never>;
} {
    return { id: deviceId, name: 'Yeast', type: 'yeast', bypassed: false, parameterValues: {} };
}

function seedYeastDevice(deviceId: string): void {
    const track = createTrack({ id: 'track-yeast', name: 'Yeast track', kind: 'midi' });
    track.devices.push(yeastDevice(deviceId));
    trackStore.set({ ...defaultTrackState, tracks: [track], selectedTrackId: 'track-yeast' });
}

/** One track per device, first track selected — the first device is `first`. */
function seedYeastDevices(first: string, second: string): void {
    const firstTrack = createTrack({ id: 'track-yeast', name: 'Yeast track', kind: 'midi' });
    firstTrack.devices.push(yeastDevice(first));
    const secondTrack = createTrack({ id: 'track-yeast-2', name: 'Yeast track 2', kind: 'midi' });
    secondTrack.devices.push(yeastDevice(second));
    trackStore.set({ ...defaultTrackState, tracks: [firstTrack, secondTrack], selectedTrackId: 'track-yeast' });
}

function processor(id: string, bypassed = false): YeastProcessorInfo {
    return { id, type: 'groove', name: id, bypassed };
}

describe('yeastStore', () => {
    let document: Doc<{ yeast?: unknown }>;

    // Inside this closure `document` is the Automerge doc, not the jsdom
    // global — keep every doc assertion here for that reason.
    function persistedRack(
        deviceId: string
    ): Record<string, { deleted: boolean; order?: number; value: YeastProcessorInfo }> {
        const slot = document.yeast as {
            racks: Record<
                string,
                { processors: Record<string, { deleted: boolean; order?: number; value: YeastProcessorInfo }> }
            >;
        };
        return slot.racks[deviceId]!.processors;
    }

    beforeEach(() => {
        document = from({});
        configureAutomergeStoragePort({
            getDoc: () => document,
            getSemanticMessage: () => undefined,
            hasDoc: () => true,
            mutateDoc: ({ changeFn }) => {
                document = change(document, (draft) => changeFn(draft as unknown as Record<string, unknown>));
            },
        });
        // Hydrate the fresh (slot-less) document so the storage adapter's
        // per-device decode mirror resets between tests — module state the
        // adapter otherwise carries across documents.
        yeastStore.hydrate();
        setActiveYeastDevice(null);
        seedYeastDevice(DEVICE_ID);
        yeastStore.set({ processors: [], uiLevel: 1 });
    });

    afterEach(() => {
        flushAutomergeStorageWrites();
        configureAutomergeStoragePort(null);
        setActiveYeastDevice(null);
        trackStore.set(defaultTrackState);
    });

    it('stores the serializable processor projection and runtime availability only', () => {
        yeastStore.set({
            processors: [
                {
                    id: 'arp-1',
                    type: 'arpeggiator',
                    name: 'Arpeggiator',
                    bypassed: false,
                    params: { rate_denom: 16 },
                },
            ],
            uiLevel: 2,
            runtimeStatus: 'ready',
        });

        expect(yeastStore.value).toEqual({
            processors: [
                {
                    id: 'arp-1',
                    type: 'arpeggiator',
                    name: 'Arpeggiator',
                    bypassed: false,
                    params: { rate_denom: 16 },
                },
            ],
            uiLevel: 2,
            runtimeStatus: 'ready',
        });
        expect(yeastStore.value).not.toHaveProperty('rackInstance');
        expect(yeastStore.value).not.toHaveProperty('_worker');
    });

    it('continues to accept serialized projections without optional parameter state', () => {
        yeastStore.set({
            processors: [{ id: 'arp-1', type: 'arpeggiator', name: 'Arpeggiator', bypassed: false }],
            uiLevel: 1,
        });

        expect(yeastStore.value?.processors[0]).toEqual({
            id: 'arp-1',
            type: 'arpeggiator',
            name: 'Arpeggiator',
            bypassed: false,
        });
    });

    it('persists processor identity in the active device rack of the project CRDT slot', () => {
        yeastStore.set({
            processors: [{ id: 'groove-durable-id', type: 'groove', name: 'Groove', bypassed: false }],
            uiLevel: 1,
        });
        flushAutomergeStorageWrites();

        expect(document.yeast).toEqual({
            schemaVersion: 2,
            racks: {
                [DEVICE_ID]: {
                    schemaVersion: 1,
                    processors: {
                        'groove-durable-id': {
                            deleted: false,
                            order: 0,
                            value: { id: 'groove-durable-id', type: 'groove', name: 'Groove', bypassed: false },
                        },
                    },
                },
            },
        });
        expect(document.yeast).not.toHaveProperty('uiLevel');
    });

    // ── Per-device scoping (issue #2422) ─────────────────────────────────────
    //
    // Two Yeast devices are two racks: adding, reordering, or bypassing on one
    // instance must leave the other's slot entry and decoded rack untouched.

    it('keeps a processor added on one device out of the other device rack', () => {
        seedYeastDevices(DEVICE_ID, SECOND_DEVICE_ID);

        setActiveYeastDevice(DEVICE_ID);
        yeastStore.set({ processors: [processor('proc-a')], uiLevel: 1 });

        // Switching devices is where a shared slot would bleed the edit
        // across: the second instance must open on an empty rack.
        setActiveYeastDevice(SECOND_DEVICE_ID);
        expect(yeastStore.value?.processors).toEqual([]);

        yeastStore.set({ processors: [processor('proc-b')], uiLevel: 1 });
        flushAutomergeStorageWrites();

        expect(Object.keys(persistedRack(DEVICE_ID))).toEqual(['proc-a']);
        expect(Object.keys(persistedRack(SECOND_DEVICE_ID))).toEqual(['proc-b']);
        expect(readYeastRack(DEVICE_ID).processors.map((entry) => entry.id)).toEqual(['proc-a']);
        expect(readYeastRack(SECOND_DEVICE_ID).processors.map((entry) => entry.id)).toEqual(['proc-b']);
    });

    it('keeps a reorder on one device out of the other device rack', () => {
        seedYeastDevices(DEVICE_ID, SECOND_DEVICE_ID);

        setActiveYeastDevice(DEVICE_ID);
        yeastStore.set({ processors: [processor('a-1'), processor('a-2')], uiLevel: 1 });
        setActiveYeastDevice(SECOND_DEVICE_ID);
        yeastStore.set({ processors: [processor('b-1'), processor('b-2')], uiLevel: 1 });
        flushAutomergeStorageWrites();

        setActiveYeastDevice(DEVICE_ID);
        yeastStore.set({ processors: [processor('a-2'), processor('a-1')], uiLevel: 1 });
        flushAutomergeStorageWrites();

        expect(persistedRack(DEVICE_ID)['a-2']?.order).toBe(0);
        expect(persistedRack(DEVICE_ID)['a-1']?.order).toBe(1);
        expect(persistedRack(SECOND_DEVICE_ID)['b-1']?.order).toBe(0);
        expect(persistedRack(SECOND_DEVICE_ID)['b-2']?.order).toBe(1);
        expect(readYeastRack(DEVICE_ID).processors.map((entry) => entry.id)).toEqual(['a-2', 'a-1']);
        expect(readYeastRack(SECOND_DEVICE_ID).processors.map((entry) => entry.id)).toEqual(['b-1', 'b-2']);
    });

    it('keeps a bypass on one device out of the other device rack', () => {
        seedYeastDevices(DEVICE_ID, SECOND_DEVICE_ID);

        setActiveYeastDevice(DEVICE_ID);
        yeastStore.set({ processors: [processor('a-1')], uiLevel: 1 });
        setActiveYeastDevice(SECOND_DEVICE_ID);
        yeastStore.set({ processors: [processor('b-1')], uiLevel: 1 });
        flushAutomergeStorageWrites();

        setActiveYeastDevice(DEVICE_ID);
        yeastStore.set({ processors: [processor('a-1', true)], uiLevel: 1 });
        flushAutomergeStorageWrites();

        expect(persistedRack(DEVICE_ID)['a-1']?.value.bypassed).toBe(true);
        expect(persistedRack(SECOND_DEVICE_ID)['b-1']?.value.bypassed).toBe(false);
        expect(readYeastRack(SECOND_DEVICE_ID).processors[0]?.bypassed).toBe(false);
    });

    it('migrates a legacy project-wide v1 slot to the first Yeast device only', () => {
        seedYeastDevices(DEVICE_ID, SECOND_DEVICE_ID);
        document = change(document, (draft) => {
            draft.yeast = {
                schemaVersion: 1,
                processors: {
                    'legacy-groove': {
                        deleted: false,
                        value: { id: 'legacy-groove', type: 'groove', name: 'Legacy groove', bypassed: false },
                    },
                },
            };
        });

        // The first instance opens with the shared rack attached…
        setActiveYeastDevice(DEVICE_ID);
        yeastStore.hydrate();
        expect(yeastStore.value?.processors.map((entry) => entry.id)).toEqual(['legacy-groove']);

        // …while the second instance reads an empty rack, never the shared one.
        expect(readYeastRack(SECOND_DEVICE_ID).processors).toEqual([]);

        // The first write through the first device materializes the rack under
        // exactly that device's key and restructures the slot to v2.
        yeastStore.set({ processors: [processor('legacy-groove')], uiLevel: 1 });
        flushAutomergeStorageWrites();

        const slot = document.yeast as { schemaVersion: number; racks: Record<string, unknown> };
        expect(slot.schemaVersion).toBe(2);
        expect(Object.keys(slot.racks)).toEqual([DEVICE_ID]);
        expect(Object.keys(persistedRack(DEVICE_ID))).toEqual(['legacy-groove']);
        expect(readYeastRack(SECOND_DEVICE_ID).processors).toEqual([]);
    });

    it('adopts the legacy rack by project order even when a later Yeast track is selected', () => {
        // Selection is concurrently-editable CRDT state: if it chose the
        // adoption target, two peers with divergent selections would each
        // adopt the parked rack under a different device id and the merged
        // document would carry it twice. The target is therefore project
        // order — identical on every peer — regardless of selection.
        seedYeastDevices(DEVICE_ID, SECOND_DEVICE_ID);
        trackStore.set({
            ...defaultTrackState,
            tracks: trackStore.value?.tracks ?? [],
            selectedTrackId: 'track-yeast-2',
        });
        // Distinct fixture from the sibling migration test above: the storage
        // layer's hydrate dedupe keys on the slot's serialized JSON, so two
        // byte-identical slots in sequence would leave the second hydrate a
        // no-op and the decode mirror stale.
        document = change(document, (draft) => {
            draft.yeast = {
                schemaVersion: 1,
                processors: {
                    'legacy-shared': {
                        deleted: false,
                        value: { id: 'legacy-shared', type: 'groove', name: 'Legacy shared', bypassed: false },
                    },
                },
            };
        });

        // The SELECTED second instance displays its own empty rack…
        setActiveYeastDevice(SECOND_DEVICE_ID);
        yeastStore.hydrate();
        expect(yeastStore.value?.processors).toEqual([]);

        // …while the project-order FIRST instance is the one that reads the
        // parked rack — selection does not move the adoption target.
        expect(readYeastRack(DEVICE_ID).processors.map((entry) => entry.id)).toEqual(['legacy-shared']);

        // A write through the selected second device must not adopt the
        // parked rack: it lands under the second device's key only.
        yeastStore.set({ processors: [processor('b-only')], uiLevel: 1 });
        flushAutomergeStorageWrites();
        const slot = document.yeast as {
            schemaVersion: number;
            racks: Record<string, { processors: Record<string, unknown> }>;
        };
        expect(Object.keys(slot.racks).sort()).toEqual([SECOND_DEVICE_ID, '__legacy_shared_rack__'].sort());
        expect(Object.keys(persistedRack(SECOND_DEVICE_ID))).toEqual(['b-only']);

        // The first device's first write adopts the parked rack, exactly as
        // with selection on the first track.
        setActiveYeastDevice(DEVICE_ID);
        yeastStore.set({ processors: [processor('legacy-shared')], uiLevel: 1 });
        flushAutomergeStorageWrites();
        const adoptedSlot = document.yeast as { racks: Record<string, unknown> };
        expect(Object.keys(adoptedSlot.racks).sort()).toEqual([DEVICE_ID, SECOND_DEVICE_ID].sort());
        expect(Object.keys(persistedRack(DEVICE_ID))).toEqual(['legacy-shared']);
        expect(persistedRack(DEVICE_ID)['legacy-shared']?.value.bypassed).toBe(false);
    });

    it('round-trips a custom arp pattern through the project CRDT document', () => {
        const pattern = [
            { ...defaultStep(), active: false, octaveOffset: -2 },
            { ...defaultStep(), stepType: 'tie' as const, velocity: 33, velocityOverride: true },
            { ...defaultStep(), gateMul: 0.4, ratchet: 3, probability: 0.5 },
        ];
        yeastStore.set({
            processors: [
                {
                    id: 'arp-1',
                    type: 'arpeggiator',
                    name: 'Arpeggiator',
                    bypassed: false,
                    params: withArpPatternParams({ mode: 7 }, pattern),
                },
            ],
            uiLevel: 3,
        });
        flushAutomergeStorageWrites();

        // Read the pattern back out of the document itself: the codec drops
        // every param value that is not a finite number, so this is the
        // assertion that the numeric encoding actually survives persistence.
        const persisted = (
            document.yeast as {
                racks: Record<string, { processors: Record<string, { value: { params?: Record<string, number> } }> }>;
            }
        ).racks[DEVICE_ID]!.processors['arp-1']!.value.params;
        expect(persisted?.mode).toBe(7);
        expect(decodeArpPatternParams(persisted)).toEqual(pattern);

        yeastStore.hydrate();
        expect(decodeArpPatternParams(yeastStore.value?.processors[0]?.params)).toEqual(pattern);
    });

    it('hydrates an arpeggiator saved without a pattern to the default pattern', () => {
        document = change(document, (draft) => {
            draft.yeast = {
                processors: [
                    {
                        id: 'legacy-arp',
                        type: 'arpeggiator',
                        name: 'Arpeggiator',
                        bypassed: false,
                        params: { mode: 7, rate_denom: 16 },
                    },
                ],
            };
        });

        yeastStore.hydrate();

        const hydrated = yeastStore.value?.processors[0];
        expect(hydrated?.params).toEqual({ mode: 7, rate_denom: 16 });
        expect(decodeArpPatternParams(hydrated?.params)).toEqual(createDefaultPattern(DEFAULT_ARP_PATTERN_LENGTH));
    });

    it('hydrates persisted processor identity before a pending reset can replace it', () => {
        document = change(document, (draft) => {
            draft.yeast = {
                processors: [{ id: 'persisted-groove', type: 'groove', name: 'Persisted groove', bypassed: false }],
            };
        });
        yeastStore.set({ processors: [], uiLevel: 4 });

        yeastStore.hydrate();
        expect(yeastStore.value).toEqual({
            processors: [{ id: 'persisted-groove', type: 'groove', name: 'Persisted groove', bypassed: false }],
            uiLevel: 4,
        });

        flushAutomergeStorageWrites();
        expect(document.yeast).toEqual({
            schemaVersion: 2,
            racks: {
                [DEVICE_ID]: {
                    schemaVersion: 1,
                    processors: {
                        'persisted-groove': {
                            deleted: false,
                            order: 0,
                            value: {
                                id: 'persisted-groove',
                                type: 'groove',
                                name: 'Persisted groove',
                                bypassed: false,
                            },
                        },
                    },
                },
            },
        });
        expect(document.yeast).not.toHaveProperty('uiLevel');
    });

    it('keeps the local UI level when project processor truth is hydrated', () => {
        yeastStore.set({ processors: [], uiLevel: 5 });

        hydrateYeastState({
            processors: [{ id: 'loaded-processor', type: 'groove', name: 'Loaded', bypassed: false }],
        });

        expect(yeastStore.value).toEqual({
            processors: [{ id: 'loaded-processor', type: 'groove', name: 'Loaded', bypassed: false }],
            uiLevel: 5,
        });
        flushAutomergeStorageWrites();
        expect(document.yeast).toMatchObject({
            schemaVersion: 2,
            racks: {
                [DEVICE_ID]: {
                    schemaVersion: 1,
                    processors: {
                        'loaded-processor': { deleted: false },
                    },
                },
            },
        });
        expect(document.yeast).not.toHaveProperty('uiLevel');
    });
});
