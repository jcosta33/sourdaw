import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { clearSolos } from './trackShortcuts';

const noop = (): void => {};

describe('trackShortcuts', () => {
    beforeEach(() => {
        Container.clear();
    });

    it('clearSolos delegates to the injected implementation', () => {
        const clearSolosImpl = vi.fn();
        injectDependencies(clearSolos, {
            clearSolos: clearSolosImpl,
            addTrack: noop as never,
            duplicateTrack: noop as never,
            duplicateClip: noop as never,
            duplicateClipToNextBar: noop as never,
            zoomTracksVertical: noop as never,
        });

        clearSolos();

        expect(clearSolosImpl).toHaveBeenCalledTimes(1);
    });
});
