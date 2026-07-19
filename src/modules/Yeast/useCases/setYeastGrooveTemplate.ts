import { executeAppAction } from '#/modules/Command/useCases';
import { getGrooveAssignment } from '#/modules/MIDI/useCases';

import { yeastStore } from '../stores/yeastStore';

import { commitYeastProjection } from './commitYeastProjection';

export async function setYeastGrooveTemplate(processorId: string, templateId: string, amount?: number): Promise<void> {
    const state = yeastStore.value;
    const processor = state?.processors.find((entry) => entry.id === processorId);
    if (!state || processor?.type !== 'groove') {
        return;
    }
    const current = getGrooveAssignment({ consumerType: 'yeast-processor', consumerId: processorId });
    await executeAppAction({
        type: 'assignGrooveTemplate',
        payload: {
            consumerType: 'yeast-processor',
            consumerId: processorId,
            templateId,
            amount: amount ?? current?.amount ?? processor.params?.amount ?? 0.5,
        },
    });
    commitYeastProjection(state.processors);
}
