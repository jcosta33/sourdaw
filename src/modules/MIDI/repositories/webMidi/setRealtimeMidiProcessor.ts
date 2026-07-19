import { realtimeMidiProcessorState } from './realtimeMidiProcessorState';

import type { RealtimeMidiProcessor } from './realtimeMidiProcessorState';

export function setRealtimeMidiProcessor(processor: RealtimeMidiProcessor): void {
    realtimeMidiProcessorState.processor = processor;
}
