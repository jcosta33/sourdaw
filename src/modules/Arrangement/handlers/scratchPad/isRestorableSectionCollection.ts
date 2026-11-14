import { type MarkerSectionSnapshot, type ScratchPadSectionSnapshot } from '#/utils/handlerContract';
import { isRecord } from '#/utils/structuralEquality';

import { type ArrangementSection } from '../../models/Marker';
import { type ScratchPadSection } from '../../models/ScratchPadSection';
import { is_valid_arrangement_section } from '../../stores/markerStore';

function isFiniteNumber(value: unknown): boolean {
    return typeof value === 'number' && Number.isFinite(value);
}

function isScratchPadSection(value: unknown): value is ScratchPadSection {
    return (
        isRecord(value) &&
        typeof value.id === 'string' &&
        isFiniteNumber(value.startBeat) &&
        isFiniteNumber(value.endBeat) &&
        typeof value.name === 'string' &&
        typeof value.color === 'string' &&
        isFiniteNumber(value.order)
    );
}

// The contract declares only the id the restore guard compares; the payload carries the
// whole sections `clearScratchPad` / `commitScratchPad` captured. These guards prove that
// before the restore writes them back.
export function isRestorableScratchPadSections(
    sections: readonly ScratchPadSectionSnapshot[]
): sections is readonly ScratchPadSection[] {
    return sections.every(isScratchPadSection);
}

// Narrows in place rather than copying: the marker store has always received the
// payload's own array, and the restore keeps writing exactly that.
export function isRestorableMarkerSections(
    sections: readonly MarkerSectionSnapshot[]
): sections is ArrangementSection[] {
    return sections.every(is_valid_arrangement_section);
}
