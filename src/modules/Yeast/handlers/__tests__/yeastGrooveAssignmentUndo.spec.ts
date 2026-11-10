import { change, from, toJS, type Doc } from '@automerge/automerge';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getProductionCommandHandlerMaps } from '#/app/getProductionCommandHandlerMaps';
import { createEventBus } from '#/infra/events/createEventBus';
import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
    runWithAutomergeStorageTransaction,
} from '#/infra/store/storage/createAutomergeStorage';
import { clearHandlerRegistry, undoHistoryStore } from '#/modules/Command/stores';
import {
    executeAppAction,
    executeAppActionBatch,
    redo,
    registerProductionCommandHandlers,
    undo,
} from '#/modules/Command/useCases';
import {
    defaultGrooveTemplateState,
    grooveTemplateProjectRevisionStore,
    grooveTemplateStore,
} from '#/modules/MIDI/stores';
import { assignGrooveTemplate, createGrooveTemplate, getScopedGrooveConsumerId } from '#/modules/MIDI/useCases';
import { defaultProjectStoreState, projectStore } from '#/modules/Project/stores';
import { initGrooveTemplateDirtyTracking } from '#/modules/Project/useCases';
import { type AppAction } from '#/utils/handlerContract';
import {
    type ConfirmPayload,
    type NotifyPayload,
    type PromptPayload,
    setNotificationEventBus,
} from '#/utils/Notification/notificationEventBus';

import { createDefaultPattern, defaultStep } from '../../models/ArpPattern';
import { setActiveYeastDevice, type YeastProcessorInfo, yeastStore } from '../../stores/yeastStore';
import { applyYeastControlProjection } from '../../useCases/applyYeastControlProjection';
import { YEAST_GROOVE_OWNER_ID } from '../../useCases/getYeastGrooveAssignment';
import { hydrateYeastState } from '../../useCases/hydrateYeastState';
import { setYeastProcessorParam } from '../../useCases/setYeastProcessorParam';

const runtime = vi.hoisted(() => ({ apply: vi.fn<() => Promise<void>>() }));
vi.mock('../../engine/yeastRuntime', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../engine/yeastRuntime')>()),
    setYeastRuntimeProjection: vi.fn(),
    applyYeastRuntimeProjection: runtime.apply,
    getYeastRuntimeStatus: () => 'ready',
    getYeastRuntimeError: () => undefined,
}));

// Undoing an accidental processor removal (#4124): the removal also deleted the
// processor's groove assignments in the groove store, and the guarded inverse
// used to restore only the processor. The remove action's describe captures the
// assignments pre-write; this spec proves the inverse re-binds them — and that
// redo removes both again — through the full dispatch/undo/redo engine.

const UNDO_SESSION_KEY = 'sourdaw-undo-session';
const DEVICE_ID = 'device-groove-undo';
const TEMPLATE_ID = 'swing-undo';

type RootDocument = Record<string, unknown> & { grooveTemplates?: unknown; yeast?: unknown };
type NotificationEvents = {
    'ui.notify': NotifyPayload;
    'ui.confirm': ConfirmPayload;
    'ui.prompt': PromptPayload;
};

function grooveProcessor(): YeastProcessorInfo {
    return { id: 'groove-1', type: 'groove', name: 'Groove', bypassed: false, params: {} };
}

function scopedConsumerId(processorId: string): string {
    return getScopedGrooveConsumerId({ ownerId: YEAST_GROOVE_OWNER_ID, localId: processorId });
}

function liveAssignment(processorId: string) {
    return grooveTemplateStore.value?.assignments.find(
        (assignment) => assignment.consumerId === scopedConsumerId(processorId)
    );
}

function configureInMemoryPort(getDocument: () => Doc<RootDocument>, setDocument: (doc: Doc<RootDocument>) => void) {
    configureAutomergeStoragePort({
        getDoc: getDocument,
        getSemanticMessage: () => undefined,
        hasDoc: () => true,
        mutateDoc: ({ changeFn }) => {
            setDocument(change(getDocument(), (draft) => changeFn(draft)));
        },
    });
}

describe('Yeast processor removal undo restores groove assignments (#4124)', () => {
    let document: Doc<RootDocument>;
    let ambiguousPublication: boolean;
    let notifications: NotifyPayload[];
    let unsubscribeFromNotifications: () => void;
    let unsubscribeDirty: () => void;

    function cleanBaseline(): number {
        flushAutomergeStorageWrites();
        projectStore.set({ ...projectStore.value!, dirty: false });
        return grooveTemplateProjectRevisionStore.value ?? 0;
    }

    function expectDirtyRevision(revision: number): void {
        expect(projectStore.value?.dirty).toBe(true);
        expect(grooveTemplateProjectRevisionStore.value).toBe(revision + 1);
    }

    function seedAssignment(consumerId: string): void {
        expect(
            assignGrooveTemplate({
                consumerType: 'yeast-processor',
                consumerId,
                templateId: 'swing-light',
                amount: 0.6,
            }).ok
        ).toBe(true);
    }

    beforeEach(() => {
        runtime.apply.mockReset().mockResolvedValue(undefined);
        ambiguousPublication = false;
        sessionStorage.removeItem(UNDO_SESSION_KEY);
        undoHistoryStore.set({ past: [], future: [] });
        document = from({});
        const notificationEventBus = createEventBus<NotificationEvents>();
        notifications = [];
        unsubscribeFromNotifications = notificationEventBus.on('ui.notify', (notification) => {
            notifications.push(notification);
        });
        setNotificationEventBus(notificationEventBus);
        configureInMemoryPort(
            () => document,
            (doc) => {
                document = doc;
                if (ambiguousPublication) {
                    throw new Error('Yeast publication observer failed');
                }
            }
        );
        yeastStore.hydrate();
        setActiveYeastDevice(DEVICE_ID);
        yeastStore.set({
            processors: [
                grooveProcessor(),
                { id: 'filter-1', type: 'filter', name: 'Filter', bypassed: false, params: {} },
            ],
            uiLevel: 3,
        });
        grooveTemplateStore.set(structuredClone(defaultGrooveTemplateState));
        registerProductionCommandHandlers(getProductionCommandHandlerMaps({ canMutateBranchMetadata: () => true }));
        projectStore.set({ ...structuredClone(defaultProjectStoreState), loading: false, initialized: true });
        unsubscribeDirty = initGrooveTemplateDirtyTracking();
    });

    afterEach(() => {
        ambiguousPublication = false;
        unsubscribeFromNotifications();
        unsubscribeDirty();
        flushAutomergeStorageWrites();
        configureAutomergeStoragePort(null);
        setActiveYeastDevice(null);
        clearHandlerRegistry();
        sessionStorage.removeItem(UNDO_SESSION_KEY);
    });

    it('re-binds the groove assignments on undo and removes them again on redo', async () => {
        const created = createGrooveTemplate({
            id: TEMPLATE_ID,
            name: 'Swing Undo',
            subdivision: '1/16',
            slots: [{ index: 1, timingOffset: 0.2, dynamicsOffset: 0 }],
            provenance: { type: 'user', sourceId: 'manual' },
        });
        const assigned = assignGrooveTemplate({
            consumerType: 'yeast-processor',
            consumerId: scopedConsumerId('groove-1'),
            templateId: created.template.id,
            amount: 0.75,
        });
        if (!assigned.ok) {
            throw new Error(`Expected the groove assignment to land: ${assigned.error.code}`);
        }

        const revision = cleanBaseline();
        await executeAppAction({
            type: 'removeYeastProcessor',
            payload: {
                processorId: 'groove-1',
                expectedProcessor: grooveProcessor(),
                expectedIndex: 0,
            },
        });
        expect(yeastStore.value?.processors.some((processor) => processor.id === 'groove-1')).toBe(false);
        expect(liveAssignment('groove-1')).toBeUndefined();
        expectDirtyRevision(revision);
        const undoRevision = cleanBaseline();

        const undone = await undo();
        expect(undone.headConsumed).toBe(true);
        expect(yeastStore.value?.processors[0]?.id).toBe('groove-1');
        expect(liveAssignment('groove-1')).toEqual({
            consumerType: 'yeast-processor',
            consumerId: scopedConsumerId('groove-1'),
            templateId: TEMPLATE_ID,
            amount: 0.75,
        });

        expectDirtyRevision(undoRevision);
        const redoRevision = cleanBaseline();
        await redo();
        expectDirtyRevision(redoRevision);
        expect(notifications).toEqual([]);
        expect(yeastStore.value?.processors.some((processor) => processor.id === 'groove-1')).toBe(false);
        expect(liveAssignment('groove-1')).toBeUndefined();
    });

    it('removes and restores a newly added processor through undo and redo', async () => {
        await executeAppAction({
            type: 'addYeastProcessor',
            payload: { processorId: 'added-1', type: 'groove', name: 'Added groove' },
        });
        flushAutomergeStorageWrites();
        expect(yeastStore.value?.processors.find((processor) => processor.id === 'added-1')).toEqual({
            id: 'added-1',
            type: 'groove',
            name: 'Added groove',
            bypassed: false,
        });
        expect(grooveTemplateStore.value?.assignments).toEqual([]);
        expect(toJS(document)).toMatchObject({
            yeast: {
                racks: {
                    [DEVICE_ID]: {
                        processors: {
                            'added-1': {
                                deleted: false,
                                value: {
                                    id: 'added-1',
                                    type: 'groove',
                                    name: 'Added groove',
                                    bypassed: false,
                                    params: {},
                                },
                            },
                        },
                    },
                },
            },
            grooveTemplates: { assignments: {} },
        });

        const undone = await undo();
        flushAutomergeStorageWrites();
        expect(undone.headConsumed).toBe(true);
        expect(yeastStore.value?.processors.some((processor) => processor.id === 'added-1')).toBe(false);
        expect(grooveTemplateStore.value?.assignments).toEqual([]);
        expect(toJS(document)).toMatchObject({
            yeast: { racks: { [DEVICE_ID]: { processors: { 'added-1': { deleted: true } } } } },
            grooveTemplates: { assignments: {} },
        });

        await redo();
        flushAutomergeStorageWrites();
        expect(yeastStore.value?.processors.find((processor) => processor.id === 'added-1')).toEqual({
            id: 'added-1',
            type: 'groove',
            name: 'Added groove',
            bypassed: false,
        });
        expect(grooveTemplateStore.value?.assignments).toEqual([]);
        expect(toJS(document)).toMatchObject({
            yeast: {
                racks: {
                    [DEVICE_ID]: {
                        processors: {
                            'added-1': {
                                deleted: false,
                                value: { id: 'added-1', params: {} },
                            },
                        },
                    },
                },
            },
            grooveTemplates: { assignments: {} },
        });
        expect(notifications).toEqual([]);
    });

    it('keeps a changed processor and the redo entry when a nonempty parameter conflicts', async () => {
        await executeAppAction({
            type: 'removeYeastProcessor',
            payload: { processorId: 'groove-1', expectedProcessor: grooveProcessor(), expectedIndex: 0 },
        });
        await undo();
        const restored = yeastStore.value!;
        yeastStore.set({
            ...restored,
            processors: restored.processors.map((processor) =>
                processor.id === 'groove-1' ? { ...processor, params: { amount: 0.5 } } : processor
            ),
        });
        flushAutomergeStorageWrites();
        expect(toJS(document)).toMatchObject({
            yeast: {
                racks: {
                    [DEVICE_ID]: {
                        processors: { 'groove-1': { deleted: false, value: { params: { amount: 0.5 } } } },
                    },
                },
            },
        });

        await redo();

        expect(yeastStore.value?.processors.find((processor) => processor.id === 'groove-1')?.params).toEqual({
            amount: 0.5,
        });
        const history = undoHistoryStore.value;
        if (!history) {
            throw new Error('Expected undo history');
        }
        expect(history.future).toHaveLength(1);
        expect(notifications).toEqual([
            { level: 'warning', message: 'Cannot redo "Remove Yeast processor": project state has changed' },
        ]);
    });

    it('restores a rack with no groove assignments for the removed processor unchanged', async () => {
        await executeAppAction({
            type: 'removeYeastProcessor',
            payload: {
                processorId: 'filter-1',
                expectedProcessor: { id: 'filter-1', type: 'filter', name: 'Filter', bypassed: false, params: {} },
                expectedIndex: 1,
            },
        });
        expect(yeastStore.value?.processors).toHaveLength(1);

        const undone = await undo();
        expect(undone.headConsumed).toBe(true);
        expect(yeastStore.value?.processors.map((processor) => processor.id)).toEqual(['groove-1', 'filter-1']);
        expect(grooveTemplateStore.value?.assignments).toEqual([]);
    });
    const cleanupActions = [
        { type: 'addYeastProcessor', payload: { processorId: 'new-filter', type: 'filter', name: 'New filter' } },
        {
            type: 'removeYeastProcessor',
            payload: {
                processorId: 'filter-1',
                expectedProcessor: { id: 'filter-1', type: 'filter', name: 'Filter', bypassed: false, params: {} },
                expectedIndex: 1,
            },
        },
        {
            type: 'reorderYeastProcessor',
            payload: { processorId: 'filter-1', toIndex: 0, expectedOrder: ['groove-1', 'filter-1', 'arp-1'] },
        },
        {
            type: 'setYeastProcessorBypass',
            payload: { processorId: 'filter-1', bypassed: true, expectedBypassed: false },
        },
        {
            type: 'setYeastProcessorParam',
            payload: { processorId: 'arp-1', paramId: 'mode', value: 1, expectedValue: 0 },
        },
        {
            type: 'setYeastArpPattern',
            payload: {
                processorId: 'arp-1',
                steps: [{ ...defaultStep(), octaveOffset: 1 }],
                expectedSteps: createDefaultPattern(8),
            },
        },
    ] satisfies AppAction[];

    function seedRacks(): void {
        setActiveYeastDevice('other-device');
        yeastStore.set({ processors: [{ ...grooveProcessor(), id: 'other-groove' }], uiLevel: 3 });
        setActiveYeastDevice(DEVICE_ID);
        yeastStore.set({
            processors: [
                grooveProcessor(),
                { id: 'filter-1', type: 'filter', name: 'Filter', bypassed: false, params: {} },
                { id: 'arp-1', type: 'arpeggiator', name: 'Arp', bypassed: false, params: { mode: 0 } },
            ],
            uiLevel: 3,
        });
        seedAssignment(scopedConsumerId('groove-1'));
        seedAssignment(scopedConsumerId('other-groove'));
    }

    it.each(cleanupActions)(
        '$type publishes one notification for multi-row cleanup while preserving every live rack',
        async (action) => {
            seedRacks();
            seedAssignment('orphan');
            seedAssignment(scopedConsumerId('orphan'));
            const revision = cleanBaseline();
            await executeAppAction(action);
            expect(grooveTemplateStore.value?.assignments.map((assignment) => assignment.consumerId).sort()).toEqual(
                [scopedConsumerId('groove-1'), scopedConsumerId('other-groove')].sort()
            );
            expect(toJS(document)).toMatchObject({
                grooveTemplates: {
                    assignments: {
                        '["yeast-processor","orphan"]': { deleted: true },
                        [JSON.stringify(['yeast-processor', scopedConsumerId('orphan')])]: { deleted: true },
                        [JSON.stringify(['yeast-processor', scopedConsumerId('other-groove')])]: { deleted: false },
                    },
                },
                yeast: { racks: { 'other-device': { processors: { 'other-groove': { deleted: false } } } } },
            });
            expectDirtyRevision(revision);
        }
    );

    it.each(cleanupActions)('$type dirties genuinely published ambiguous cleanup truth', async (action) => {
        seedRacks();
        seedAssignment('orphan');
        const revision = cleanBaseline();
        ambiguousPublication = true;
        await expect(executeAppAction(action)).rejects.toMatchObject({
            name: 'AppActionCommittedError',
            cause: { message: 'Yeast publication observer failed' },
        });
        expect(toJS(document)).toMatchObject({
            grooveTemplates: { assignments: { '["yeast-processor","orphan"]': { deleted: true } } },
        });
        expect(grooveTemplateStore.value?.assignments.some((assignment) => assignment.consumerId === 'orphan')).toBe(
            false
        );
        expectDirtyRevision(revision);
    });

    it.each(cleanupActions)('$type without groove cleanup publishes no groove notification', async (action) => {
        seedRacks();
        const assignments = structuredClone(grooveTemplateStore.value?.assignments);
        const revision = cleanBaseline();
        await executeAppAction(action);
        expect(grooveTemplateStore.value?.assignments).toEqual(assignments);
        expect(projectStore.value?.dirty).toBe(false);
        expect(grooveTemplateProjectRevisionStore.value).toBe(revision);
    });

    it('restores both captured assignments after cleaning a separate orphan on the add Undo leg', async () => {
        seedAssignment('groove-1');
        seedAssignment(scopedConsumerId('groove-1'));
        const originalAssignments = structuredClone(grooveTemplateStore.value?.assignments);
        const revision = cleanBaseline();
        await executeAppAction({
            type: 'removeYeastProcessor',
            payload: { processorId: 'groove-1', expectedProcessor: grooveProcessor(), expectedIndex: 0 },
        });
        expect(grooveTemplateStore.value?.assignments).toEqual([]);
        expectDirtyRevision(revision);
        seedAssignment('separate-orphan');
        const undoRevision = cleanBaseline();
        await undo();
        expect(grooveTemplateStore.value?.assignments).toEqual(originalAssignments);
        expect(yeastStore.value?.processors.map((processor) => processor.id)).toEqual(['groove-1', 'filter-1']);
        expect(toJS(document)).toMatchObject({
            grooveTemplates: {
                assignments: {
                    '["yeast-processor","groove-1"]': { deleted: false },
                    '["yeast-processor","separate-orphan"]': { deleted: true },
                },
            },
        });
        expectDirtyRevision(undoRevision);
        const redoRevision = cleanBaseline();
        await redo();
        expect(grooveTemplateStore.value?.assignments).toEqual([]);
        expectDirtyRevision(redoRevision);
    });

    it.each(cleanupActions.slice(4))(
        '$type waits for runtime acknowledgement before publication, then dirties',
        async (action) => {
            seedRacks();
            seedAssignment('orphan');
            const revision = cleanBaseline();
            const originalDocument = document;
            const acknowledgement = Promise.withResolvers<void>();
            runtime.apply.mockReturnValueOnce(acknowledgement.promise);
            const execution = executeAppAction(action);
            await vi.waitFor(() => expect(runtime.apply).toHaveBeenCalled());
            expect(document).toBe(originalDocument);
            expect(
                grooveTemplateStore.value?.assignments.some((assignment) => assignment.consumerId === 'orphan')
            ).toBe(false);
            expect(projectStore.value?.dirty).toBe(false);
            expect(grooveTemplateProjectRevisionStore.value).toBe(revision);
            acknowledgement.resolve();
            await execution;
            expect(document).not.toBe(originalDocument);
            expectDirtyRevision(revision);
        }
    );

    it.each(cleanupActions.slice(4))(
        '$type rolls back cleanup without notification when the awaited runtime fails',
        async (action) => {
            seedRacks();
            seedAssignment('orphan');
            const revision = cleanBaseline();
            const originalDocument = document;
            const originalGrooves = structuredClone(grooveTemplateStore.value);
            const originalRack = structuredClone(yeastStore.value?.processors);
            const originalHistory = structuredClone(undoHistoryStore.value);
            const acknowledgement = Promise.withResolvers<void>();
            runtime.apply.mockReturnValueOnce(acknowledgement.promise);
            const execution = executeAppAction(action);
            const rejected = expect(execution).rejects.toThrow('worker acknowledgement failed');
            await vi.waitFor(() => expect(runtime.apply).toHaveBeenCalled());
            expect(document).toBe(originalDocument);
            acknowledgement.reject(new Error('worker acknowledgement failed'));
            await rejected;
            expect(document).toBe(originalDocument);
            expect(grooveTemplateStore.value).toEqual(originalGrooves);
            expect(yeastStore.value?.processors).toEqual(originalRack);
            expect(undoHistoryStore.value).toEqual(originalHistory);
            expect(projectStore.value?.dirty).toBe(false);
            expect(grooveTemplateProjectRevisionStore.value).toBe(revision);
        }
    );

    it.each(cleanupActions.slice(4))(
        '$type discards pending cleanup when real batch authority is revoked during worker acknowledgement',
        async (action) => {
            seedRacks();
            seedAssignment('orphan');
            const revision = cleanBaseline();
            const originalDocument = document;
            const originalGrooves = structuredClone(grooveTemplateStore.value);
            const originalRack = structuredClone(yeastStore.value?.processors);
            const originalHistory = structuredClone(undoHistoryStore.value);
            const acknowledgement = Promise.withResolvers<void>();
            runtime.apply.mockReturnValueOnce(acknowledgement.promise);
            const controller = new AbortController();
            const execution = executeAppActionBatch([action], {
                signal: controller.signal,
                shouldExecute: () => !controller.signal.aborted,
            });
            await vi.waitFor(() => expect(runtime.apply).toHaveBeenCalled());
            expect(document).toBe(originalDocument);
            controller.abort();
            acknowledgement.resolve();
            expect(await execution).toMatchObject({ status: 'cancelled' });
            expect(document).toBe(originalDocument);
            expect(grooveTemplateStore.value).toEqual(originalGrooves);
            expect(yeastStore.value?.processors).toEqual(originalRack);
            expect(undoHistoryStore.value).toEqual(originalHistory);
            expect(projectStore.value?.dirty).toBe(false);
            expect(grooveTemplateProjectRevisionStore.value).toBe(revision);
        }
    );

    it('refuses a late status callback after its captured storage transaction was aborted', async () => {
        const revision = cleanBaseline();
        const originalDocument = document;
        const originalRack = structuredClone(yeastStore.value);
        const acknowledgement = Promise.withResolvers<void>();
        runtime.apply.mockReturnValueOnce(acknowledgement.promise);
        const transaction = runWithAutomergeStorageTransaction(undefined, () => applyYeastControlProjection([]));
        if (transaction.status !== 'returned') {
            throw new Error('Expected a suspended projection transaction');
        }
        transaction.abort();
        acknowledgement.resolve();
        await expect(transaction.value).rejects.toThrow('Automerge storage transaction has already settled (aborted)');
        expect(document).toBe(originalDocument);
        expect(yeastStore.value).toEqual(originalRack);
        expect(projectStore.value?.dirty).toBe(false);
        expect(grooveTemplateProjectRevisionStore.value).toBe(revision);
    });

    it('keeps transient audition and real file hydration clean even when hydration cleans an orphan', async () => {
        seedAssignment('orphan');
        const revision = cleanBaseline();
        const originalDocument = document;
        await setYeastProcessorParam('groove-1', 'amount', 0.8, true);
        expect(document).toBe(originalDocument);
        expect(grooveTemplateProjectRevisionStore.value).toBe(revision);
        hydrateYeastState({ racks: { [DEVICE_ID]: { processors: [grooveProcessor()] } } });
        flushAutomergeStorageWrites();
        expect(grooveTemplateStore.value?.assignments).toEqual([]);
        expect(toJS(document)).toMatchObject({
            grooveTemplates: { assignments: { '["yeast-processor","orphan"]': { deleted: true } } },
        });
        expect(projectStore.value?.dirty).toBe(false);
        expect(grooveTemplateProjectRevisionStore.value).toBe(revision);
    });
});
