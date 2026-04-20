import { describe, it, expect, vi, beforeEach } from 'vitest';

import { getTransportState } from '#/modules/Transport/useCases';

import { getTrackState } from '../../../repositories/track/getTrackState';
import { setClipClipboard } from '../../../stores/clipboardStore';
import { pasteClip } from '../pasteClip';

vi.mock('../../../repositories/track/getTrackState', () => ({
    getTrackState: vi.fn(),
}));
vi.mock('#/modules/Transport/useCases', () => ({
    getTransportState: vi.fn(),
}));
vi.mock('../../clip/addClip', () => ({
    addClip: vi.fn(),
}));
vi.mock('#/modules/MIDI/useCases', () => ({
    createMidiNote: vi.fn(),
}));

describe('pasteClip', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        setClipClipboard([]);
    });

    it('returns early when the clip clipboard is empty without reading transport', () => {
        pasteClip();

        expect(getTransportState).not.toHaveBeenCalled();
        expect(getTrackState).not.toHaveBeenCalled();
    });
});
