import { grooveTemplateProjectRevisionStore } from '#/modules/MIDI/stores';

import { markDirty } from './markDirty';

export function initGrooveTemplateDirtyTracking(): () => void {
    return grooveTemplateProjectRevisionStore.subscribe(() => markDirty());
}
