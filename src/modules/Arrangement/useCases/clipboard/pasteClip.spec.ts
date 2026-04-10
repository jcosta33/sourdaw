import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { setClipClipboard } from '#/modules/Arrangement/stores/clipboardStore';
import { pasteClip } from './pasteClip';

describe('pasteClip', () => {
    beforeEach(() => {
        Container.clear();
        setClipClipboard([]);
    });

    it('returns early when the clip clipboard is empty without reading transport', () => {
        const getTrackState = vi.fn();
        const getTransportState = vi.fn();
        const addClip = vi.fn();
        const createMidiNote = vi.fn();
        injectDependencies(pasteClip, { getTrackState, getTransportState, addClip, createMidiNote });

        pasteClip();

        expect(getTransportState).not.toHaveBeenCalled();
        expect(getTrackState).not.toHaveBeenCalled();
    });
});
