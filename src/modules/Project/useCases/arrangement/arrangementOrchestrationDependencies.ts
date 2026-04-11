import { stopPlayback } from '#/modules/Transport/useCases';
import { markDirty } from '../projectPersistence/saveProject/markDirty';

export const arrangementOrchestrationDependencies = {
    stopPlayback,
    markDirty,
} as const;