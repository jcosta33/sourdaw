export type ChordMemoryCommand = 'learn' | 'clear';

export type YeastProcessorCommand =
    { processorId: string; type: 'chordMemory.learn' } | { processorId: string; type: 'chordMemory.clear' };
