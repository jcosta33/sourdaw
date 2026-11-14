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

// The pad edit never touches markers, so both sides of the marker guard carry the same live
// snapshot: the restore still refuses if the marker ids moved, and leaves the markers unwritten.
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
