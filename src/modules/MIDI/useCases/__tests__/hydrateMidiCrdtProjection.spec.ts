import { expect, it, vi } from 'vitest';

import { hydrateMidiCrdtProjection } from '../hydrateMidiCrdtProjection';

const mocks = vi.hoisted(() => ({ chord: vi.fn(), groove: vi.fn(), midi: vi.fn() }));
vi.mock('../../stores/chordTrackStore', () => ({ chordTrackStore: { hydrate: mocks.chord } }));
vi.mock('../../stores/grooveTemplateStore', () => ({ grooveTemplateStore: { hydrate: mocks.groove } }));
vi.mock('../../stores/midiStore', () => ({ midiStore: { hydrate: mocks.midi } }));
it('hydrates every MIDI-owned project projection', () => {
    hydrateMidiCrdtProjection();
    expect(mocks.midi).toHaveBeenCalledOnce();
    expect(mocks.groove).toHaveBeenCalledOnce();
    expect(mocks.chord).toHaveBeenCalledOnce();
});
