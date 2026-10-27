import { sliceMidiNoteExtent } from '../../services/sliceMidiNoteExtent';

/** Keep recorded expression at its performed beats when a frozen source row is resized. */
export function sliceMidiTakeNoteForEdit(
    note: Parameters<typeof sliceMidiNoteExtent>[0],
    extent: Parameters<typeof sliceMidiNoteExtent>[1]
): ReturnType<typeof sliceMidiNoteExtent> {
    return sliceMidiNoteExtent(note, extent);
}
