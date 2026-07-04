import { projectStore } from '#/modules/Project/stores';

import { stepRecordStore } from '../../stores/stepRecordStore';

import { getNextStepRecordPitch } from './stepRecordNavigation';

export function stepRecordStepUp(): void {
    const state = stepRecordStore.value;
    const project = projectStore.value;
    if (!state || !state.active || !project) {
        return;
    }

    const nextPitch = getNextStepRecordPitch({
        currentPitch: state.currentPitch,
        direction: 'up',
        keyRoot: project.keyRoot,
        scaleName: project.scaleName,
    });

    stepRecordStore.set({ ...state, currentPitch: Math.min(127, nextPitch) });
}
