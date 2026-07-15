import { sendYeastRuntimeCommand } from '../engine/yeastRuntime';
import { yeastStore } from '../stores/yeastStore';

import type { ChordMemoryCommand, YeastProcessorCommand } from '../models/YeastProcessorCommand';

export function sendYeastProcessorCommand(
    id: string,
    command: ChordMemoryCommand
):
    | { delivered: true }
    | {
          delivered: false;
          reason: 'processor-not-found' | 'unsupported-processor' | 'runtime-unavailable' | 'delivery-failed';
      } {
    const state = yeastStore.value;
    const processor = state?.processors.find((entry) => entry.id === id);
    if (!processor) {
        return { delivered: false, reason: 'processor-not-found' };
    }
    if (processor.type !== 'chordMemory') {
        return { delivered: false, reason: 'unsupported-processor' };
    }

    const runtimeCommand: YeastProcessorCommand =
        command === 'learn'
            ? { processorId: id, type: 'chordMemory.learn' }
            : { processorId: id, type: 'chordMemory.clear' };
    return sendYeastRuntimeCommand(runtimeCommand);
}
