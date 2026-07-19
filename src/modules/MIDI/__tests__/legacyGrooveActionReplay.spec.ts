import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { clearHandlerRegistry, registerHandlerMap } from '#/modules/Command/stores';
import { executeAppAction } from '#/modules/Command/useCases';

import { defaultGrooveTemplateState, grooveTemplateStore } from '../stores/grooveTemplateStore';
import { getMidiGrooveHandlers } from '../useCases/getMidiGrooveHandlers';

describe('legacy groove action replay', () => {
    beforeEach(() => {
        clearHandlerRegistry();
        registerHandlerMap(getMidiGrooveHandlers());
        grooveTemplateStore.set(structuredClone(defaultGrooveTemplateState));
    });

    afterEach(() => clearHandlerRegistry());

    it('replays the persisted Straight alias through the current assignment handler', async () => {
        await executeAppAction({
            type: 'assignGrooveTemplate',
            payload: {
                consumerType: 'clip',
                consumerId: 'legacy-macro-clip',
                templateId: 'straight',
                amount: 1,
            },
        });

        expect(grooveTemplateStore.value?.assignments).toContainEqual({
            consumerType: 'clip',
            consumerId: 'legacy-macro-clip',
            templateId: 'groove-straight',
            amount: 1,
        });
    });
});
