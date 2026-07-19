import { getStraightGrooveTemplateId } from '#/modules/MIDI/useCases';

import { yeastStore } from '../stores/yeastStore';

import { commitYeastProjection } from './commitYeastProjection';
import { getYeastGrooveAssignment } from './getYeastGrooveAssignment';
import { setYeastGrooveTemplate } from './setYeastGrooveTemplate';

export function setYeastProcessorParam(id: string, name: string, value: number): void {
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
    if (processor.type === 'groove' && name === 'amount') {
        const assignment = getYeastGrooveAssignment(id);
        const clampedAmount = Math.max(0, Math.min(1, value));
        void setYeastGrooveTemplate(id, assignment?.templateId ?? getStraightGrooveTemplateId(), clampedAmount);
        return;
    }
    commitYeastProjection(
        state.processors.map((entry) =>
            entry.id === id ? { ...entry, params: { ...entry.params, [name]: value } } : entry
        )
    );
}
