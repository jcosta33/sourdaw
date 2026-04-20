import { markerStore } from '../../../stores/markerStore';
import { scratchPadStore } from '../../../stores/scratchPadStore';

export const captureCommitDependencies = {
    scratchPadStore,
    markerStore,
} as const;
