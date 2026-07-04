import { projectStore } from '#/modules/Project/stores';

import { stepRecordStore } from '../../stores/stepRecordStore';

import { getNextStepRecordPitch } from './stepRecordNavigation';

export function stepRecordStepDown(): void {
    const state = stepRecordStore.value;
    const project = projectStore.value;
    if (!state || !state.active || !project) {
        return;
    }

    const nextPitch = getNextStepRecordPitch({
        currentPitch: state.currentPitch,
        direction: 'down',
        keyRoot: project.keyRoot,
        scaleName: project.scaleName,
    });

    stepRecordStore.set({ ...state, currentPitch: Math.max(0, nextPitch) });
}
