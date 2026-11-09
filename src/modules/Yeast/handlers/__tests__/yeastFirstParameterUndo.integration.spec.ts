import { change, from, type Doc } from '@automerge/automerge';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getProductionCommandHandlerMaps } from '#/app/getProductionCommandHandlerMaps';
import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { TrackDummy } from '#/modules/Arrangement/__tests__/TrackDummy';
import { trackStore } from '#/modules/Arrangement/stores';
import { clearHandlerRegistry, undoHistoryStore } from '#/modules/Command/stores';
import {
    executeAppAction,
    executeAppActionBatch,
    redo,
    registerProductionCommandHandlers,
    undo,
} from '#/modules/Command/useCases';

import { PROCESSOR_PARAM_DEFAULTS } from '../../models/ProcessorCatalog';
import { readYeastRack, setActiveYeastDevice, yeastStore } from '../../stores/yeastStore';

vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: vi.fn() }));

vi.mock('../../engine/yeastRuntime', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../engine/yeastRuntime')>()),
    setYeastRuntimeProjection: vi.fn(),
    applyYeastRuntimeProjection: vi.fn(async () => {}),
    getYeastRuntimeStatus: () => 'ready',
    getYeastRuntimeError: () => undefined,
}));

type RootDocument = { yeast?: unknown };
const DEVICE_ID = 'yeast-device';
const PROCESSOR_ID = 'arp-first-rate';

describe('first Yeast parameter edit undo', () => {
    let document: Doc<RootDocument>;
    const track = TrackDummy.create({
        id: 'midi-track',
        kind: 'midi',
        devices: [{ id: DEVICE_ID, name: 'Yeast', type: 'yeast', bypassed: false, parameterValues: {} }],
    });

    beforeEach(() => {
        undoHistoryStore.set({ past: [], future: [] });
        document = from({});
        configureAutomergeStoragePort({
            getDoc: () => document,
            getSemanticMessage: () => undefined,
            hasDoc: () => true,
            mutateDoc: ({ changeFn }) => {
                document = change(document, (draft) => changeFn(draft as unknown as Record<string, unknown>));
            },
        });
        trackStore.set({ tracks: [track], selectedTrackId: track.id, ghostClips: [] });
        yeastStore.hydrate();
        setActiveYeastDevice(DEVICE_ID);
        clearHandlerRegistry();
        registerProductionCommandHandlers(getProductionCommandHandlerMaps({ canMutateBranchMetadata: () => true }));
    });

    afterEach(() => {
        flushAutomergeStorageWrites();
        configureAutomergeStoragePort(null);
        setActiveYeastDevice(null);
        clearHandlerRegistry();
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
    });

    it('restores the initial first rate on Undo and replays it on Redo', async () => {
        await executeAppAction({
            type: 'addYeastProcessor',
            payload: { processorId: PROCESSOR_ID, type: 'arpeggiator', name: 'Arpeggiator' },
        });
        flushAutomergeStorageWrites();
        const originalRaw = structuredClone(document.yeast);
        const originalRack = structuredClone(readYeastRack(DEVICE_ID));
        const originalTrack = structuredClone(trackStore.value?.tracks);
        const processor = originalRack.processors.find((entry) => entry.id === PROCESSOR_ID);
        expect(processor).toBeDefined();
        expect(processor?.params).toEqual(PROCESSOR_PARAM_DEFAULTS.arpeggiator);
        expect(processor?.params?.rate_denom).toBe(8);
        const originalPast = undoHistoryStore.value?.past.length;

        await executeAppAction({
            type: 'setYeastProcessorParam',
            payload: { processorId: PROCESSOR_ID, paramId: 'rate_denom', value: 14 },
        });
        flushAutomergeStorageWrites();
        const committedRaw = structuredClone(document.yeast);
        const committedRack = structuredClone(readYeastRack(DEVICE_ID));
        expect(committedRack.processors.find((entry) => entry.id === PROCESSOR_ID)?.params?.rate_denom).toBe(14);
        expect(undoHistoryStore.value?.past.length).toBe((originalPast ?? 0) + 1);

        await undo();
        flushAutomergeStorageWrites();
        expect(structuredClone(document.yeast)).toEqual(originalRaw);
        expect(readYeastRack(DEVICE_ID).processors).toEqual(originalRack.processors);
        expect(readYeastRack(DEVICE_ID).processors.find((entry) => entry.id === PROCESSOR_ID)?.params?.rate_denom).toBe(
            8
        );
        expect(trackStore.value?.tracks).toEqual(originalTrack);
        expect(undoHistoryStore.value?.past.length).toBe(originalPast);
        expect(undoHistoryStore.value?.future).toHaveLength(1);

        await redo();
        flushAutomergeStorageWrites();
        expect(structuredClone(document.yeast)).toEqual(committedRaw);
        expect(readYeastRack(DEVICE_ID).processors).toEqual(committedRack.processors);
        expect(trackStore.value?.tracks).toEqual(originalTrack);
        await undo();
        flushAutomergeStorageWrites();
        expect(structuredClone(document.yeast)).toEqual(originalRaw);
        expect(readYeastRack(DEVICE_ID).processors).toEqual(originalRack.processors);

        await undo();
        flushAutomergeStorageWrites();
        expect(readYeastRack(DEVICE_ID).processors.some((entry) => entry.id === PROCESSOR_ID)).toBe(false);
        expect(undoHistoryStore.value?.future).toHaveLength(2);

        await redo();
        flushAutomergeStorageWrites();
        expect(structuredClone(document.yeast)).toEqual(originalRaw);
        expect(readYeastRack(DEVICE_ID).processors).toEqual(originalRack.processors);
        await undo();
        flushAutomergeStorageWrites();
        expect(readYeastRack(DEVICE_ID).processors.some((entry) => entry.id === PROCESSOR_ID)).toBe(false);
    });

    it('replays a captured empty Arpeggiator add without changing its paired remove inverse', async () => {
        await executeAppAction({
            type: 'addYeastProcessor',
            payload: { processorId: PROCESSOR_ID, type: 'arpeggiator', name: 'Arpeggiator' },
        });
        await undo();
        flushAutomergeStorageWrites();
        const entry = undoHistoryStore.value?.future.at(-1);
        expect(entry?.kind).toBe('action');
        if (entry?.kind !== 'action' || entry.inverseAction?.type !== 'removeYeastProcessor') {
            throw new Error('Expected the add and its captured remove inverse');
        }
        // A saved pre-fix entry carried an empty created snapshot. Preserve the
        // real Command action and history identity while installing that old
        // paired inverse in the pending history slot.
        const legacyEntry = {
            ...entry,
            inverseAction: {
                ...entry.inverseAction,
                payload: {
                    ...entry.inverseAction.payload,
                    expectedProcessor: { ...entry.inverseAction.payload.expectedProcessor, params: {} },
                },
            },
        };
        undoHistoryStore.set({ past: [], future: [legacyEntry] });
        expect(legacyEntry.inverseAction.payload.expectedProcessor.params).toEqual({});
        expect(readYeastRack(DEVICE_ID).processors.some((processor) => processor.id === PROCESSOR_ID)).toBe(false);
        expect(undoHistoryStore.value?.future).toHaveLength(1);

        await redo();
        flushAutomergeStorageWrites();
        const rawAfterRedo = structuredClone(document.yeast);
        expect(rawAfterRedo).toMatchObject({
            racks: { [DEVICE_ID]: { processors: { [PROCESSOR_ID]: { value: { params: {} } } } } },
        });
        expect(
            readYeastRack(DEVICE_ID).processors.find((processor) => processor.id === PROCESSOR_ID)?.params ?? {}
        ).toEqual({});
        const replayedEntry = undoHistoryStore.value?.past.at(-1);
        expect(replayedEntry).toBe(legacyEntry);
        if (replayedEntry?.kind !== 'action' || replayedEntry.inverseAction?.type !== 'removeYeastProcessor') {
            throw new Error('Expected the same paired remove inverse after redo');
        }
        expect(replayedEntry.inverseAction.payload.expectedProcessor.params).toEqual({});

        await undo();
        flushAutomergeStorageWrites();
        expect(structuredClone(document.yeast)).toMatchObject({
            racks: { [DEVICE_ID]: { processors: { [PROCESSOR_ID]: { deleted: true, value: { params: {} } } } } },
        });
        expect(readYeastRack(DEVICE_ID).processors.some((processor) => processor.id === PROCESSOR_ID)).toBe(false);
        expect(undoHistoryStore.value?.future).toHaveLength(1);
    });

    it('replays an old empty Arpeggiator add inside a real grouped history unit', async () => {
        await executeAppAction({
            type: 'addYeastProcessor',
            payload: { processorId: 'neighbor', type: 'chord', name: 'Neighbor chord' },
        });
        undoHistoryStore.set({ past: [], future: [] });
        const grouped = await executeAppActionBatch(
            [
                { type: 'addYeastProcessor', payload: { processorId: PROCESSOR_ID, type: 'arpeggiator', name: 'Arp' } },
                {
                    type: 'setYeastProcessorBypass',
                    payload: { processorId: 'neighbor', bypassed: true, expectedBypassed: false },
                },
            ],
            { groupId: 'legacy-arp-group', groupLabel: 'Add Arp and bypass neighbor' }
        );
        expect(grouped.status).toBe('committed');
        expect(undoHistoryStore.value?.past).toHaveLength(2);
        expect(new Set(undoHistoryStore.value?.past.map((entry) => entry.groupId)).size).toBe(1);

        await undo();
        flushAutomergeStorageWrites();
        expect(readYeastRack(DEVICE_ID).processors.find((entry) => entry.id === 'neighbor')?.bypassed).toBe(false);
        expect(readYeastRack(DEVICE_ID).processors.some((entry) => entry.id === PROCESSOR_ID)).toBe(false);
        const future = undoHistoryStore.value?.future ?? [];
        const addEntry = future.find((entry) => entry.kind === 'action' && entry.action.type === 'addYeastProcessor');
        if (addEntry?.kind !== 'action' || addEntry.inverseAction?.type !== 'removeYeastProcessor') {
            throw new Error('Expected grouped add with a captured remove inverse');
        }
        const legacyEntry = {
            ...addEntry,
            inverseAction: {
                ...addEntry.inverseAction,
                payload: {
                    ...addEntry.inverseAction.payload,
                    expectedProcessor: { ...addEntry.inverseAction.payload.expectedProcessor, params: {} },
                },
            },
        };
        undoHistoryStore.set({
            past: [],
            future: future.map((entry) => (entry === addEntry ? legacyEntry : entry)),
        });
        const pendingGroup = undoHistoryStore.value?.future ?? [];
        expect(pendingGroup).toHaveLength(2);
        expect(new Set(pendingGroup.map((entry) => entry.groupId)).size).toBe(1);

        await redo();
        flushAutomergeStorageWrites();
        expect(readYeastRack(DEVICE_ID).processors.find((entry) => entry.id === PROCESSOR_ID)?.params ?? {}).toEqual(
            {}
        );
        expect(structuredClone(document.yeast)).toMatchObject({
            racks: { [DEVICE_ID]: { processors: { [PROCESSOR_ID]: { value: { params: {} } } } } },
        });
        expect(readYeastRack(DEVICE_ID).processors.find((entry) => entry.id === 'neighbor')?.bypassed).toBe(true);
        const redoneAdd = undoHistoryStore.value?.past.find(
            (entry) => entry.kind === 'action' && entry.action.type === 'addYeastProcessor'
        );
        expect(redoneAdd).toBe(legacyEntry);
        if (redoneAdd?.kind !== 'action' || redoneAdd.inverseAction?.type !== 'removeYeastProcessor') {
            throw new Error('Expected the same grouped add capture after redo');
        }
        expect(redoneAdd.inverseAction.payload.expectedProcessor.params).toEqual({});

        await undo();
        flushAutomergeStorageWrites();
        expect(readYeastRack(DEVICE_ID).processors.some((entry) => entry.id === PROCESSOR_ID)).toBe(false);
        expect(readYeastRack(DEVICE_ID).processors.find((entry) => entry.id === 'neighbor')?.bypassed).toBe(false);
    });

    it.each(['name', 'params', 'append index'] as const)(
        'keeps a mismatched %s add capture pending without writing project truth',
        async (mismatch) => {
            await executeAppAction({
                type: 'addYeastProcessor',
                payload: { processorId: PROCESSOR_ID, type: 'arpeggiator', name: 'Arpeggiator' },
            });
            await undo();
            flushAutomergeStorageWrites();
            const beforeRaw = structuredClone(document.yeast);
            const beforeRack = structuredClone(readYeastRack(DEVICE_ID));
            const entry = undoHistoryStore.value?.future.at(-1);
            if (entry?.kind !== 'action' || entry.inverseAction?.type !== 'removeYeastProcessor') {
                throw new Error('Expected a pending add and its remove capture');
            }
            const inverseAction = {
                ...entry.inverseAction,
                payload: {
                    ...entry.inverseAction.payload,
                    expectedProcessor: {
                        ...entry.inverseAction.payload.expectedProcessor,
                        ...(mismatch === 'name' ? { name: 'Different Arp' } : {}),
                        ...(mismatch === 'params' ? { params: { rate_denom: 11 } } : {}),
                    },
                    expectedIndex: mismatch === 'append index' ? 1 : 0,
                },
            };
            const mismatchedEntry = { ...entry, inverseAction };
            undoHistoryStore.set({ past: [], future: [mismatchedEntry] });

            await redo();
            flushAutomergeStorageWrites();
            expect(structuredClone(document.yeast)).toEqual(beforeRaw);
            expect(readYeastRack(DEVICE_ID)).toEqual(beforeRack);
            expect(undoHistoryStore.value?.past).toEqual([]);
            expect(undoHistoryStore.value?.future).toEqual([mismatchedEntry]);
        }
    );
});
