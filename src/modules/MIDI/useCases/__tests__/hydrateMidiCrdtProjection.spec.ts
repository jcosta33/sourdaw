import { expect, it, vi } from 'vitest';

import { chordTrackStore } from '../../stores/chordTrackStore';
import { hydrateMidiCrdtProjection } from '../hydrateMidiCrdtProjection';

it('hydrates chord project truth with the MIDI projection', () => {
    const hydrate = vi.spyOn(chordTrackStore, 'hydrate');
    hydrateMidiCrdtProjection();
    expect(hydrate).toHaveBeenCalledOnce();
});
