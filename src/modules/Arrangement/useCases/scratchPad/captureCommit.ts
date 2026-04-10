import { inject } from '#/infra/di/inject';
import { scratchPadStore } from '../../stores/scratchPadStore';
import { markerStore } from '../../stores/markerStore';
import { createScratchPadSection } from '../../models/ScratchPadSection';

export const captureCommitDependencies = {
    scratchPadStore,
    markerStore,
} as const;

/**
 * Capture the current arrangement sections into the scratch pad.
 * Replaces whatever is currently in the scratch pad.
 */
export const captureArrangementToScratchPad = inject(captureCommitDependencies)(
    ({ markerStore: markers, scratchPadStore: padStore }) =>
        function captureArrangementToScratchPad(): void {
            const markerState = markers.value;
            if (!markerState || markerState.sections.length === 0) {
                return;
            }
            const sorted = [...markerState.sections].sort((a, b) => a.startBeat - b.startBeat);
            const scratchSections = sorted.map((s, i) =>
                createScratchPadSection(s.startBeat, s.endBeat, s.name, s.color, i)
            );
            padStore.set({ sections: scratchSections });
        }
);

/**
 * Commit the scratch pad arrangement back to the main timeline.
 */
export const commitScratchPadToArrangement = inject(captureCommitDependencies)(
    ({ scratchPadStore: padStore, markerStore: markers }) =>
        function commitScratchPadToArrangement(): void {
            const padState = padStore.value;
            const markerState = markers.value;
            if (!padState || !markerState || padState.sections.length === 0) {
                return;
            }

            const newSections = [...padState.sections]
                .sort((a, b) => a.order - b.order)
                .map((s) => ({
                    id: `section-committed-${crypto.randomUUID().slice(0, 8)}`,
                    startBeat: s.startBeat,
                    endBeat: s.endBeat,
                    name: s.name,
                    color: s.color,
                }));

            markers.set({ ...markerState, sections: newSections });
        }
);
