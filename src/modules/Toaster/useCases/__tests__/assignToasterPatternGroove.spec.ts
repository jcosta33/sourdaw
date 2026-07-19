import { beforeEach, describe, expect, it, vi } from 'vitest';

import { defaultGrooveTemplateState, grooveTemplateStore } from '#/modules/MIDI/stores';
import { assignGrooveTemplate, createGrooveTemplate } from '#/modules/MIDI/useCases';

import { assignToasterPatternGroove } from '../assignToasterPatternGroove';
import { setToasterGrooveAssignmentExecutor } from '../setToasterGrooveAssignmentExecutor';

const mocks = vi.hoisted(() => ({
    executeAppAction: vi.fn<Parameters<typeof setToasterGrooveAssignmentExecutor>[0]['execute']>(),
}));

describe('assignToasterPatternGroove', () => {
    beforeEach(() => {
        mocks.executeAppAction.mockImplementation((action) => {
            assignGrooveTemplate(action.payload);
            return Promise.resolve();
        });
        setToasterGrooveAssignmentExecutor({ execute: mocks.executeAppAction });
        grooveTemplateStore.set(structuredClone(defaultGrooveTemplateState));
        createGrooveTemplate({
            id: 'toaster-pocket',
            name: 'Toaster pocket',
            subdivision: '1/16',
            slots: [{ index: 1, timingOffset: 0.1, dynamicsOffset: 0 }],
            provenance: { type: 'user', sourceId: 'toaster-pocket' },
        });
    });

    it('owns a device-scoped production assignment action', async () => {
        await assignToasterPatternGroove({
            deviceId: 'toaster-a',
            patternId: 'A1',
            templateId: 'toaster-pocket',
            amount: 0.65,
        });

        expect(grooveTemplateStore.value?.assignments).toContainEqual({
            consumerType: 'toaster-pattern',
            consumerId: 'groove-consumer:toaster-a:A1',
            templateId: 'toaster-pocket',
            amount: 0.65,
        });
        expect(mocks.executeAppAction).toHaveBeenCalledWith({
            type: 'assignGrooveTemplate',
            payload: {
                consumerType: 'toaster-pattern',
                consumerId: 'groove-consumer:toaster-a:A1',
                templateId: 'toaster-pocket',
                amount: 0.65,
            },
        });
    });
});
