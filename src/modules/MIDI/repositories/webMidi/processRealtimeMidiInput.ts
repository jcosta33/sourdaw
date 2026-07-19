import { realtimeMidiProcessorState } from './realtimeMidiProcessorState';

import type { RealtimeMidiInput, RealtimeMidiEvent } from './realtimeMidiProcessorState';

export function processRealtimeMidiInput(input: RealtimeMidiInput): Promise<RealtimeMidiEvent[]> {
    return realtimeMidiProcessorState.processor(input);
}
