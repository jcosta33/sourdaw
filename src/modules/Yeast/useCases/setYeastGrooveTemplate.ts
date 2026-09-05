import { logger } from '#/infra/logger/appLogger';
import { executeUserAppAction } from '#/modules/Command/useCases';
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

    const assignment = getYeastGrooveAssignment(processorId);
    try {
        await executeUserAppAction({
            type: 'assignGrooveTemplate',
            payload: {
                consumerType: 'yeast-processor',
                consumerId: getScopedGrooveConsumerId({
                    ownerId: YEAST_GROOVE_OWNER_ID,
                    localId: processorId,
                }),
                templateId,
                amount: amount ?? assignment?.amount ?? processor.params?.amount ?? 0.5,
            },
        });
    } catch (error: unknown) {
        logger.error(new Error('Failed to assign the Yeast groove template', { cause: error }));
        throw error;
    } finally {
        const currentState = yeastStore.value;
        if (currentState) {
            setYeastRuntimeProjection(createYeastRuntimeProjection(currentState.processors));
        }
    }
}
