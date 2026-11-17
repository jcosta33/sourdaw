import { describe, expectTypeOf, it } from 'vitest';

import { type DrumPreviewNoteSnapshot } from '#/modules/CrdtDocument/events';

import { type MidiClipNoteSnapshot } from '../midiClipDataSnapshots';

describe('MidiClipNoteSnapshot', () => {
    it('is exactly the note shape a CrdtDocument drum preview plan carries', () => {
        // The kernel declares its own copy because it may not import MIDI; the
        // projector bound at the composition root feeds MIDI notes into it.
        expectTypeOf<DrumPreviewNoteSnapshot>().toEqualTypeOf<MidiClipNoteSnapshot>();
    });
});
