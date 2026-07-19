import { type GrooveTemplateState } from '#/modules/MIDI/stores';

import { type ProjectGrooveState } from '../../../models/ProjectData';

export function serializeProjectGrooves(state: GrooveTemplateState): ProjectGrooveState {
    return structuredClone(state);
}
