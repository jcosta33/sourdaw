import { executeAppAction } from '#/modules/Command/useCases';
import { getScopedGrooveConsumerId } from '#/modules/MIDI/useCases';

import { setYeastRuntimeProjection } from '../engine/yeastRuntime';
import { yeastStore } from '../stores/yeastStore';

import { createYeastRuntimeProjection } from './createYeastRuntimeProjection';
import { getYeastGrooveAssignment, YEAST_GROOVE_OWNER_ID } from './getYeastGrooveAssignment';

export async function setYeastGrooveTemplate(processorId: string, templateId: string, amount?: number): Promise<void> {
    const state = yeastStore.value;
    const processor = state?.processors.find((entry) => entry.id === processorId);
    if (!state || processor?.type !== 'groove') {
        return;
    }
    const current = getYeastGrooveAssignment(processorId);
    await executeAppAction({
        type: 'assignGrooveTemplate',
        payload: {
            consumerType: 'yeast-processor',
            consumerId: getScopedGrooveConsumerId({ ownerId: YEAST_GROOVE_OWNER_ID, localId: processorId }),
            templateId,
            amount: amount ?? current?.amount ?? processor.params?.amount ?? 0.5,
        },
    });
    const currentState = yeastStore.value;
    if (currentState) {
        setYeastRuntimeProjection(createYeastRuntimeProjection(currentState.processors));
    }
}
