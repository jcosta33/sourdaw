import { beforeEach, describe, expect, it, vi } from 'vitest';

import { hydrateMidiCrdtProjection } from '../hydrateMidiCrdtProjection';

const mocks = vi.hoisted(() => ({
    chordTrackHydrate: vi.fn(),
    grooveTemplateHydrate: vi.fn(),
    midiHydrate: vi.fn(),
}));

vi.mock('../../stores/chordTrackStore', () => ({
    chordTrackStore: { hydrate: mocks.chordTrackHydrate },
}));

vi.mock('../../stores/grooveTemplateStore', () => ({
    grooveTemplateStore: { hydrate: mocks.grooveTemplateHydrate },
}));

vi.mock('../../stores/midiStore', () => ({
    midiStore: { hydrate: mocks.midiHydrate },
}));

describe('hydrateMidiCrdtProjection', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('hydrates every MIDI-owned project projection', () => {
        hydrateMidiCrdtProjection();

        expect(mocks.midiHydrate).toHaveBeenCalledOnce();
        expect(mocks.grooveTemplateHydrate).toHaveBeenCalledOnce();
        expect(mocks.chordTrackHydrate).toHaveBeenCalledOnce();
    });
});
