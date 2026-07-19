import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
    defaultGrooveTemplateState,
    grooveTemplateProjectRevisionStore,
    grooveTemplateStore,
} from '#/modules/MIDI/stores';
import { getMidiGrooveHandlers, hydrateGrooveTemplates } from '#/modules/MIDI/useCases';

import { defaultProjectStoreState, projectStore } from '../../../../stores/projectStore';
import { resetModuleStoresToDefault } from '../../helpers/resetModuleStoresToDefault';
import { initGrooveTemplateDirtyTracking } from '../initGrooveTemplateDirtyTracking';

import type { HandlerExecutionResult } from '#/utils/handlerContract';

describe('groove template project dirty lifecycle', () => {
    let unsubscribe: (() => void) | undefined;

    beforeEach(() => {
        grooveTemplateStore.set(structuredClone(defaultGrooveTemplateState));
        grooveTemplateProjectRevisionStore.set(0);
        projectStore.set({ ...structuredClone(defaultProjectStoreState), loading: false, initialized: true });
        unsubscribe = initGrooveTemplateDirtyTracking();
    });

    afterEach(() => unsubscribe?.());

    function expectDirtyAfter(
        operation: () => void | HandlerExecutionResult | Promise<void | HandlerExecutionResult>
    ): Promise<void> {
        projectStore.set({ ...projectStore.value!, dirty: false });
        return Promise.resolve(operation()).then(() => expect(projectStore.value?.dirty).toBe(true));
    }

    it('marks create, rename, delete, apply, and undo writes dirty', async () => {
        const handlers = getMidiGrooveHandlers();
        const createAction = {
            type: 'createGrooveTemplate' as const,
            payload: {
                id: 'dirty-groove',
                name: 'Dirty groove',
                subdivision: '1/16' as const,
                slots: [],
                provenance: { type: 'user' as const, sourceId: 'dirty-test' },
            },
        };
        await expectDirtyAfter(() => handlers.createGrooveTemplate.execute(createAction));
        await expectDirtyAfter(() =>
            handlers.renameGrooveTemplate.execute({
                type: 'renameGrooveTemplate',
                payload: { templateId: 'dirty-groove', name: 'Renamed dirty groove' },
            })
        );

        const applyAction = {
            type: 'applyGroove' as const,
            payload: { clipId: 'dirty-clip', grooveId: 'swing-light' },
        };
        const applyInverse = handlers.applyGroove.describe(applyAction).inverseAction;
        await expectDirtyAfter(() => handlers.applyGroove.execute(applyAction));
        if (applyInverse?.type !== 'restoreGrooveAssignment') {
            throw new Error('Expected groove assignment inverse');
        }
        await expectDirtyAfter(() => handlers.restoreGrooveAssignment.execute(applyInverse));

        await expectDirtyAfter(() =>
            handlers.deleteGrooveTemplate.execute({
                type: 'deleteGrooveTemplate',
                payload: { templateId: 'dirty-groove' },
            })
        );
    });

    it('keeps load hydration and new-project reset clean', () => {
        projectStore.set({ ...projectStore.value!, dirty: false });
        hydrateGrooveTemplates({ templates: [], assignments: [] });
        expect(projectStore.value?.dirty).toBe(false);

        resetModuleStoresToDefault();
        expect(projectStore.value?.dirty).toBe(false);
    });
});
