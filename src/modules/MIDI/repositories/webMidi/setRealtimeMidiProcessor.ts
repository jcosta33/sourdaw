import { passThroughRealtimeMidi, realtimeMidiProcessorState } from './realtimeMidiProcessorState';

import type { RealtimeMidiProcessor } from './realtimeMidiProcessorState';

export function setRealtimeMidiProcessor(processor: RealtimeMidiProcessor): () => void {
    realtimeMidiProcessorState.processor = processor;
    let active = true;
    return () => {
        if (!active) {
            return;
        }
        active = false;
        if (realtimeMidiProcessorState.processor === processor) {
            realtimeMidiProcessorState.processor = passThroughRealtimeMidi;
        }
    };
}
