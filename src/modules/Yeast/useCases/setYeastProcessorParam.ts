import { getStraightGrooveTemplateId } from '#/modules/MIDI/useCases';

import { applyYeastRuntimeProjection } from '../engine/yeastRuntime';
import { publishAppliedYeastPreviewRevision, publishPendingYeastPreviewRevision } from '../stores/yeastPreviewRevision';
import { yeastStore } from '../stores/yeastStore';

import { commitYeastProjection } from './commitYeastProjection';
import { createYeastRuntimeProjection } from './createYeastRuntimeProjection';
import { getYeastGrooveAssignment } from './getYeastGrooveAssignment';
import { setYeastGrooveTemplate } from './setYeastGrooveTemplate';

function createPreviewYeastProcessorProjection(id: string, name: string, value: number) {
    const state = yeastStore.value;
    if (!state) {
        return null;
    }

    const processors = state.processors.map((entry) => {
        if (entry.id !== id) {
            return entry;
        }
        return { ...entry, params: { ...entry.params, [name]: value } };
    });
    const projection = createYeastRuntimeProjection(processors);
    if (name !== 'amount') {
        return projection;
    }

    const clampedAmount = Math.max(0, Math.min(1, value));
    return projection.map((entry) => {
        if (entry.id !== id || entry.type !== 'groove') {
            return entry;
        }
        return { ...entry, params: { ...entry.params, groove_amount: clampedAmount } };
    });
}

export async function setYeastProcessorParam(
    id: string,
    name: string,
    value: number,
    isTransient = false
): Promise<void> {
    const state = yeastStore.value;
    if (!state) {
        return;
    }

    const processor = state.processors.find((entry) => entry.id === id);
    if (!processor) {
        return;
    }
    if (processor.type === 'chordMemory' && (name === 'learn' || name === 'clear')) {
        return;
    }
    if (isTransient) {
        const projection = createPreviewYeastProcessorProjection(id, name, value);
        if (!projection) {
            return;
        }
        const revisionDetails = { processorId: id, parameterName: name, transient: true };
        const revision = publishPendingYeastPreviewRevision(revisionDetails);
        await applyYeastRuntimeProjection(projection);
        publishAppliedYeastPreviewRevision({ ...revisionDetails, revision });
        return;
    }
    if (processor.type === 'groove' && name === 'amount') {
        const assignment = getYeastGrooveAssignment(id);
        const clampedAmount = Math.max(0, Math.min(1, value));
        const revisionDetails = { processorId: id, parameterName: name, transient: false };
        const revision = publishPendingYeastPreviewRevision(revisionDetails);
        await setYeastGrooveTemplate(id, assignment?.templateId ?? getStraightGrooveTemplateId(), clampedAmount);
        const currentState = yeastStore.value;
        if (!currentState) {
            return;
        }
        await applyYeastRuntimeProjection(createYeastRuntimeProjection(currentState.processors));
        publishAppliedYeastPreviewRevision({ ...revisionDetails, revision });
        return;
    }
    const revisionDetails = { processorId: id, parameterName: name, transient: false };
    const revision = publishPendingYeastPreviewRevision(revisionDetails);
    commitYeastProjection(
        state.processors.map((entry) =>
            entry.id === id ? { ...entry, params: { ...entry.params, [name]: value } } : entry
        )
    );
    const currentState = yeastStore.value;
    if (!currentState) {
        return;
    }
    await applyYeastRuntimeProjection(createYeastRuntimeProjection(currentState.processors));
    publishAppliedYeastPreviewRevision({ ...revisionDetails, revision });
}
