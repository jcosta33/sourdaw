import { scratchPadStore } from '../../../stores/scratchPadStore';
import { markerStore } from '../../../stores/markerStore';

export const captureCommitDependencies = {
    scratchPadStore,
    markerStore,
} as const;