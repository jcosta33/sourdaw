import { realtimeMidiProcessorState } from './realtimeMidiProcessorState';

import type { RealtimeMidiEvent, RealtimeMidiInput } from './realtimeMidiProcessorState';

export function processRealtimeMidiInput(input: RealtimeMidiInput): Promise<RealtimeMidiEvent[]> {
    return realtimeMidiProcessorState.processor(input);
}
