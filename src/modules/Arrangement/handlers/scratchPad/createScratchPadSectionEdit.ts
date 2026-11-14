import { type HandlerDescribeResult } from '#/utils/handlerContract';
import { valuesEqual } from '#/utils/structuralEquality';

import { type ScratchPadSection } from '../../models/ScratchPadSection';
import { markerStore } from '../../stores/markerStore';
import { scratchPadStore } from '../../stores/scratchPadStore';

type ScratchPadProjection = (sections: readonly ScratchPadSection[]) => readonly ScratchPadSection[];

export function readLiveScratchPadSections(): readonly ScratchPadSection[] {
    return scratchPadStore.value?.sections ?? [];
}

export function isScratchPadEditNoop(project: ScratchPadProjection): boolean {
    const live = readLiveScratchPadSections();
    return valuesEqual(project(live), live);
}

// The pad edit never touches markers, so its inverse carries equal marker snapshots on both
// sides. `handleRestoreScratchPadState` then neither guards nor writes markers: it checks marker
// ids and writes markers only when the expected and replacement snapshots differ.
export function describeScratchPadSectionEdit(label: string, project: ScratchPadProjection): HandlerDescribeResult {
    const capturedSections = structuredClone(readLiveScratchPadSections());
    const producedSections = structuredClone(project(capturedSections));
    const capturedMarkerSections = structuredClone(markerStore.value?.sections ?? []);
    return {
        label,
        inverseAction: {
            type: 'restoreScratchPadState',
            payload: {
                expectedSections: producedSections,
                replacementSections: capturedSections,
                expectedMarkerSections: capturedMarkerSections,
                replacementMarkerSections: capturedMarkerSections,
            },
        },
    };
}
