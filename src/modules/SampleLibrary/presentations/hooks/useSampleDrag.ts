import { type SampleRecord } from '../../models/LibraryTypes';

/**
 * Hook for dragging samples from the library into the DAW timeline.
 * R-G4: DAW Drag-Out.
 */
export const useSampleDrag = (sample: SampleRecord) => {
    const handleDragStart = (e: React.DragEvent) => {
        // Set sample ID and basic metadata for the drop target
        e.dataTransfer.setData(
            'application/x-sourdaw-sample',
            JSON.stringify({
                id: sample.id,
                name: sample.displayName,
                duration: sample.format.durationSec,
                bpm: sample.analysis?.bpm,
                key: sample.analysis?.key,
            })
        );

        // Fallback for generic file drops
        e.dataTransfer.setData('text/plain', sample.relativePath);

        // Indicate copy action
        e.dataTransfer.dropEffect = 'copy';
    };

    return { handleDragStart };
};

/**
 * Service for tempo-synced sample auditioning.
 * R-G4: Contextual auditioning.
 */
export const sampleAuditionEngine = {
    // eslint-disable-next-line @typescript-eslint/require-await -- stub implementation; async for future real-time time-stretching
    async audition(sample: SampleRecord, projectBpm: number): Promise<void> {
        // Logic for playing the sample with real-time time-stretching
        // if sample BPM differs from project BPM.
        console.log(`Auditioning ${sample.displayName} at ${projectBpm} BPM (Sample BPM: ${sample.analysis?.bpm})`);
    },
    stop(): void {
        console.log('Stopping audition');
    },
};
