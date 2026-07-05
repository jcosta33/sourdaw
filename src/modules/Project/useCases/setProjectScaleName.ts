import { SCALE_PATTERNS } from '#/utils/Music/MusicalScale';

import { projectStore } from '../stores/projectStore';

export function setProjectScaleName(scaleName: string): void {
    const project = projectStore.value;
    if (!project) {
        return;
    }

    if (!Object.prototype.hasOwnProperty.call(SCALE_PATTERNS, scaleName)) {
        return;
    }

    projectStore.set({ ...project, scaleName });
}
