import { getStraightGrooveTemplateId } from '#/modules/MIDI/useCases';

import { setYeastRuntimeProjection } from '../engine/yeastRuntime';
import { yeastStore } from '../stores/yeastStore';

import { commitYeastProjection } from './commitYeastProjection';
import { createYeastRuntimeProjection } from './createYeastRuntimeProjection';
import { getYeastGrooveAssignment } from './getYeastGrooveAssignment';
import { setYeastGrooveTemplate } from './setYeastGrooveTemplate';

function previewYeastProcessorParam(id: string, name: string, value: number): void {
    const state = yeastStore.value;
    if (!state) {
        return;
    }

    const processors = state.processors.map((entry) => {
        if (entry.id !== id) {
            return entry;
        }
        return { ...entry, params: { ...entry.params, [name]: value } };
    });
    const projection = createYeastRuntimeProjection(processors);
    if (name !== 'amount') {
        setYeastRuntimeProjection(projection);
        return;
    }

    const clampedAmount = Math.max(0, Math.min(1, value));
    setYeastRuntimeProjection(
        projection.map((entry) => {
            if (entry.id !== id || entry.type !== 'groove') {
                return entry;
            }
            return { ...entry, params: { ...entry.params, groove_amount: clampedAmount } };
        })
    );
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
        previewYeastProcessorParam(id, name, value);
        return;
    }
    if (processor.type === 'groove' && name === 'amount') {
        const assignment = getYeastGrooveAssignment(id);
        const clampedAmount = Math.max(0, Math.min(1, value));
        await setYeastGrooveTemplate(id, assignment?.templateId ?? getStraightGrooveTemplateId(), clampedAmount);
        return;
    }
    commitYeastProjection(
        state.processors.map((entry) =>
            entry.id === id ? { ...entry, params: { ...entry.params, [name]: value } } : entry
        )
    );
}
