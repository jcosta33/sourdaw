import { change, from, getHeads } from '@automerge/automerge';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { registerProjectLifecycle } from '#/app/registerProjectLifecycle';
import {
    configureAutomergeStoragePort,
    createAutomergeStoragePreview,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { clearHandlerRegistry, registerHandlerMap, undoStore } from '#/modules/Command/stores';
import { clearUndoHistory, executeAppAction, executeAppActionBatch, redo, undo } from '#/modules/Command/useCases';
import {
    defaultGrooveTemplateState,
    defaultMidiStoreState,
    grooveTemplateProjectRevisionStore,
    grooveTemplateStore,
    midiStore,
} from '#/modules/MIDI/stores';
import { getMidiGrooveHandlers, hydrateGrooveTemplates } from '#/modules/MIDI/useCases';

import { defaultProjectStoreState, projectStore } from '../../../../stores/projectStore';
import { resetModuleStoresToDefault } from '../../helpers/resetModuleStoresToDefault';
import { initGrooveTemplateDirtyTracking } from '../initGrooveTemplateDirtyTracking';

import type { AppAction } from '#/utils/handlerContract';

const createAction = {
    type: 'createGrooveTemplate',
    payload: {
        id: 'dirty-groove',
        name: 'Dirty groove',
        subdivision: '1/16',
        slots: [],
        provenance: { type: 'user', sourceId: 'dirty-test' },
    },
} satisfies AppAction;

const applyAction = {
    type: 'applyGroove',
    payload: { clipId: 'dirty-clip', grooveId: 'swing-light' },
} satisfies AppAction;

// Real Command transactions and Automerge adapters; the port fault is at the
// publication boundary, rather than a handler-result or notification double.
describe('groove template project dirty lifecycle', () => {
    let unsubscribe: (() => void) | undefined;
    let document = from<Record<string, unknown>>({});
    let publication: 'normal' | 'refused' | 'ambiguous';
    let revision: number;

    function saveDirtyBaseline(): void {
        projectStore.set({ ...projectStore.value!, dirty: false });
        revision = grooveTemplateProjectRevisionStore.value ?? 0;
    }

    function expectClean(): void {
        expect(projectStore.value?.dirty).toBe(false);
        expect(grooveTemplateProjectRevisionStore.value).toBe(revision);
    }

    async function expectDirtyAfter(operation: () => Promise<unknown>): Promise<void> {
        saveDirtyBaseline();
        const heads = getHeads(document);
        await operation();
        expect(getHeads(document)).not.toEqual(heads);
        expect(projectStore.value?.dirty).toBe(true);
        expect(grooveTemplateProjectRevisionStore.value).toBe(revision + 1);
    }

    beforeEach(() => {
        registerProjectLifecycle();
        publication = 'normal';
        document = from({});
        configureAutomergeStoragePort({
            getDoc: () => document,
            getDocHeads: () => getHeads(document),
            getSemanticMessage: () => undefined,
            hasDoc: () => true,
            mutateDoc: ({ changeFn, beforeChange }) => {
                if (publication === 'refused') {
                    throw new Error('Groove publication refused');
                }
                beforeChange?.(document);
                document = change(document, changeFn);
                if (publication === 'ambiguous') {
                    throw new Error('Groove publication observer failed');
                }
            },
        });
        hydrateGrooveTemplates(structuredClone(defaultGrooveTemplateState));
        midiStore.set(structuredClone(defaultMidiStoreState));
        flushAutomergeStorageWrites();
        clearHandlerRegistry();
        registerHandlerMap(getMidiGrooveHandlers());
        clearUndoHistory();
        projectStore.set({ ...structuredClone(defaultProjectStoreState), loading: false, initialized: true });
        unsubscribe = initGrooveTemplateDirtyTracking();
        saveDirtyBaseline();
    });

    afterEach(() => {
        unsubscribe?.();
        publication = 'normal';
        clearUndoHistory();
        clearHandlerRegistry();
        configureAutomergeStoragePort(null);
    });

    it('publishes create, rename, restore-name, delete and restore-delete through real replay', async () => {
        await expectDirtyAfter(() => executeAppAction(createAction));
        expect(document).toMatchObject({ grooveTemplates: { templates: { 'dirty-groove': { deleted: false } } } });
        await expectDirtyAfter(() =>
            executeAppAction({
                type: 'renameGrooveTemplate',
                payload: { templateId: 'dirty-groove', name: 'Renamed groove' },
            })
        );
        expect(grooveTemplateStore.value?.templates.find((template) => template.id === 'dirty-groove')?.name).toBe(
            'Renamed groove'
        );
        await expectDirtyAfter(undo);
        expect(grooveTemplateStore.value?.templates.find((template) => template.id === 'dirty-groove')?.name).toBe(
            'Dirty groove'
        );
        await expectDirtyAfter(redo);
        await expectDirtyAfter(() =>
            executeAppAction({ type: 'deleteGrooveTemplate', payload: { templateId: 'dirty-groove' } })
        );
        expect(document).toMatchObject({ grooveTemplates: { templates: { 'dirty-groove': { deleted: true } } } });
        await expectDirtyAfter(undo);
        expect(document).toMatchObject({ grooveTemplates: { templates: { 'dirty-groove': { deleted: false } } } });
        await expectDirtyAfter(redo);
    });

    it('publishes apply, assign and restore-assignment while retaining actual assignment inverses', async () => {
        await expectDirtyAfter(() => executeAppAction(applyAction));
        expect(grooveTemplateStore.value?.assignments).toEqual([
            { consumerType: 'clip', consumerId: 'dirty-clip', templateId: 'swing-light', amount: 1 },
        ]);
        await expectDirtyAfter(undo);
        expect(grooveTemplateStore.value?.assignments).toEqual([]);
        await expectDirtyAfter(redo);
        await expectDirtyAfter(() =>
            executeAppAction({
                type: 'assignGrooveTemplate',
                payload: { consumerType: 'clip', consumerId: 'dirty-clip', templateId: 'swing-heavy', amount: 0.4 },
            })
        );
        await expectDirtyAfter(undo);
        expect(grooveTemplateStore.value?.assignments[0]?.templateId).toBe('swing-light');
    });

    it('publishes real extracted source truth', async () => {
        midiStore.set({
            ...midiStore.value!,
            notesByClipId: { source: [{ id: 'note', startBeat: 0.02, duration: 0.2, velocity: 96, pitch: 60 }] },
        });
        flushAutomergeStorageWrites();
        await expectDirtyAfter(() =>
            executeAppAction({
                type: 'extractGroove',
                payload: { clipId: 'source', templateId: 'extracted', sourceName: 'Source' },
            })
        );
        expect(grooveTemplateStore.value?.templates).toContainEqual(
            expect.objectContaining({ id: 'extracted', slots: [{ index: 0, timingOffset: 0.08, dynamicsOffset: 0 }] })
        );
        expect(document).toMatchObject({ grooveTemplates: { templates: { extracted: { deleted: false } } } });
    });

    it('leaves identical, missing and guarded-conflict operations clean', async () => {
        await executeAppAction(createAction);
        await executeAppAction(applyAction);
        saveDirtyBaseline();
        const heads = getHeads(document);
        await executeAppAction(createAction);
        await executeAppAction(applyAction);
        await executeAppAction({
            type: 'renameGrooveTemplate',
            payload: { templateId: 'dirty-groove', name: 'Dirty groove' },
        });
        await executeAppAction({ type: 'deleteGrooveTemplate', payload: { templateId: 'missing' } });
        await executeAppAction({
            type: 'restoreGrooveAssignment',
            payload: { consumerType: 'clip', consumerId: 'absent', assignment: null },
        });
        await expect(
            executeAppAction({
                type: 'restoreGrooveAssignment',
                payload: {
                    consumerType: 'clip',
                    consumerId: 'dirty-clip',
                    assignment: null,
                    expectedAssignment: {
                        consumerType: 'clip',
                        consumerId: 'dirty-clip',
                        templateId: 'swing-heavy',
                        amount: 1,
                    },
                },
            })
        ).rejects.toThrow('diverged');
        expect(getHeads(document)).toEqual(heads);
        expectClean();
    });

    it.each(['single', 'batch'] as const)(
        'keeps a refused %s publication clean after the real handler wrote',
        async (route) => {
            const heads = getHeads(document);
            publication = 'refused';
            if (route === 'single') {
                await expect(executeAppAction(createAction)).rejects.toThrow('Groove publication refused');
            } else {
                await expect(executeAppActionBatch([createAction])).resolves.toMatchObject({ status: 'failed' });
            }
            expect(getHeads(document)).toEqual(heads);
            expect(grooveTemplateStore.value).toEqual(defaultGrooveTemplateState);
            expect(undoStore.value?.past).toHaveLength(0);
            expectClean();
        }
    );

    it.each(['single', 'batch'] as const)('notifies genuinely published ambiguous %s truth', async (route) => {
        publication = 'ambiguous';
        if (route === 'single') {
            await expect(executeAppAction(createAction)).rejects.toMatchObject({
                name: 'AppActionCommittedError',
                cause: { message: 'Groove publication observer failed' },
            });
        } else {
            await expect(executeAppActionBatch([createAction])).resolves.toMatchObject({ status: 'ambiguous' });
        }
        expect(document).toMatchObject({ grooveTemplates: { templates: { 'dirty-groove': { deleted: false } } } });
        expect(grooveTemplateStore.value?.templates).toContainEqual(expect.objectContaining({ id: 'dirty-groove' }));
        expect(projectStore.value?.dirty).toBe(true);
        expect(grooveTemplateProjectRevisionStore.value).toBeGreaterThan(revision);
    });

    it('publishes a real singleton batch after the owning write lands', async () => {
        await executeAppActionBatch([createAction]);
        expect(document).toMatchObject({ grooveTemplates: { templates: { 'dirty-groove': { deleted: false } } } });
        expect(projectStore.value?.dirty).toBe(true);
        expect(grooveTemplateProjectRevisionStore.value).toBe(revision + 1);
    });

    it('cancels a real singleton batch after the handler candidate without dirtying', async () => {
        const controller = new AbortController();
        const handlers = getMidiGrooveHandlers();
        clearHandlerRegistry();
        registerHandlerMap({
            ...handlers,
            createGrooveTemplate: {
                ...handlers.createGrooveTemplate,
                execute: (action) => {
                    const result = handlers.createGrooveTemplate.execute(action);
                    controller.abort();
                    return result;
                },
            },
        });
        const heads = getHeads(document);
        const result = await executeAppActionBatch([createAction], {
            signal: controller.signal,
            shouldExecute: () => !controller.signal.aborted,
        });
        expect(result).toMatchObject({ status: 'cancelled' });
        expect(getHeads(document)).toEqual(heads);
        expect(grooveTemplateStore.value).toEqual(defaultGrooveTemplateState);
        expect(undoStore.value?.past).toHaveLength(0);
        expectClean();
    });

    it('keeps an isolated real handler candidate out of live truth, history and dirty state', () => {
        const heads = getHeads(document);
        const live = structuredClone(grooveTemplateStore.value);
        const history = structuredClone(undoStore.value);
        const preview = createAutomergeStoragePreview(new Map([['root', document]]));
        try {
            preview.scope(() => {
                getMidiGrooveHandlers().createGrooveTemplate.execute(createAction);
                expect(grooveTemplateStore.value?.templates).toContainEqual(
                    expect.objectContaining({ id: 'dirty-groove' })
                );
            });
            expect(preview.getDocument('root')).toMatchObject({
                grooveTemplates: { templates: { 'dirty-groove': { deleted: false } } },
            });
            expect(getHeads(document)).toEqual(heads);
            expect(grooveTemplateStore.value).toEqual(live);
            expect(undoStore.value).toEqual(history);
            expectClean();
        } finally {
            preview.release();
        }
    });

    const isolatedWriters: Array<{
        name: string;
        execute: (handlers: ReturnType<typeof getMidiGrooveHandlers>) => unknown;
    }> = [
        {
            name: 'assign',
            execute: (handlers) =>
                handlers.assignGrooveTemplate.execute({
                    type: 'assignGrooveTemplate',
                    payload: { consumerType: 'clip', consumerId: 'dirty-clip', templateId: 'swing-heavy', amount: 0.3 },
                }),
        },
        {
            name: 'apply',
            execute: (handlers) =>
                handlers.applyGroove.execute({
                    type: 'applyGroove',
                    payload: { clipId: 'dirty-clip', grooveId: 'swing-heavy' },
                }),
        },
        {
            name: 'delete',
            execute: (handlers) =>
                handlers.deleteGrooveTemplate.execute({
                    type: 'deleteGrooveTemplate',
                    payload: { templateId: 'existing' },
                }),
        },
        {
            name: 'rename',
            execute: (handlers) =>
                handlers.renameGrooveTemplate.execute({
                    type: 'renameGrooveTemplate',
                    payload: { templateId: 'existing', name: 'Candidate name' },
                }),
        },
        {
            name: 'restore-name',
            execute: (handlers) =>
                handlers.restoreGrooveTemplateName.execute({
                    type: 'restoreGrooveTemplateName',
                    payload: { templateId: 'existing', name: 'Restored name', expectedName: 'Existing' },
                }),
        },
        {
            name: 'restore-assignment',
            execute: (handlers) =>
                handlers.restoreGrooveAssignment.execute({
                    type: 'restoreGrooveAssignment',
                    payload: {
                        consumerType: 'clip',
                        consumerId: 'dirty-clip',
                        assignment: {
                            consumerType: 'clip',
                            consumerId: 'dirty-clip',
                            templateId: 'swing-heavy',
                            amount: 0.6,
                        },
                    },
                }),
        },
        {
            name: 'remove-assignment',
            execute: (handlers) =>
                handlers.restoreGrooveAssignment.execute({
                    type: 'restoreGrooveAssignment',
                    payload: { consumerType: 'clip', consumerId: 'dirty-clip', assignment: null },
                }),
        },
        {
            name: 'restore-deleted',
            execute: (handlers) =>
                handlers.restoreDeletedGrooveTemplate.execute({
                    type: 'restoreDeletedGrooveTemplate',
                    payload: {
                        template: { ...createAction.payload, id: 'restored', name: 'Restored', schemaVersion: 1 },
                        templateIndex: 1,
                        assignments: [],
                    },
                }),
        },
        {
            name: 'extract',
            execute: (handlers) =>
                handlers.extractGroove.execute({
                    type: 'extractGroove',
                    payload: { clipId: 'source', templateId: 'candidate-extracted', sourceName: 'Source' },
                }),
        },
    ];

    it.each(isolatedWriters)(
        'keeps isolated $name candidate writes clean through the real handler/storage scope',
        async ({ execute }) => {
            await executeAppAction({
                ...createAction,
                payload: { ...createAction.payload, id: 'existing', name: 'Existing' },
            });
            await executeAppAction(applyAction);
            midiStore.set({
                ...midiStore.value!,
                notesByClipId: { source: [{ id: 'note', startBeat: 0.02, duration: 0.2, velocity: 96, pitch: 60 }] },
            });
            flushAutomergeStorageWrites();
            saveDirtyBaseline();
            const liveDocument = document;
            const live = structuredClone(grooveTemplateStore.value);
            const history = structuredClone(undoStore.value);
            const preview = createAutomergeStoragePreview(new Map([['root', document]]));
            try {
                const result = preview.scope(() => execute(getMidiGrooveHandlers()));
                expect(result).toMatchObject({ status: 'written' });
                expect(preview.getDocument('root')?.grooveTemplates).not.toEqual(document.grooveTemplates);
                expect(document).toBe(liveDocument);
                expect(grooveTemplateStore.value).toEqual(live);
                expect(undoStore.value).toEqual(history);
                expectClean();
            } finally {
                preview.release();
            }
        }
    );

    it('keeps load hydration and new-project reset clean at the runtime notification too', () => {
        hydrateGrooveTemplates({ templates: [], assignments: [] });
        expectClean();
        resetModuleStoresToDefault();
        expectClean();
    });
});
