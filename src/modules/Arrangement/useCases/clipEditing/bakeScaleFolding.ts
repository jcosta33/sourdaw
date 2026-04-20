import { projectStore } from '#/modules/Project/stores';

import { updateClip } from '../updateClip';

export function bakeClipScaleFolding(clipId: string): void {
    const project = projectStore.value;
    if (!project) {
        return;
    }

    updateClip(clipId, (clip) => ({
        ...clip,
        // When baking, we commit the current folded MIDI as the new source MIDI,
        // and update the source key to match the project key.
        sourceKeyRoot: project.keyRoot,
        sourceScaleName: project.scaleName,
    }));

    // NOTE: This assumes the calling code also updates the actual MIDI notes
    // in the arrangement store to the folded values.
}
