import { beforeEach, describe, expect, it, vi } from 'vitest';

import { desktopInvoke, isDesktopRuntime } from '#/utils/desktopBridge';

import { setEngineTransportMaps } from '../setEngineTransportMaps';

vi.mock('#/utils/desktopBridge', () => ({
    desktopInvoke: vi.fn(),
    isDesktopRuntime: vi.fn(() => true),
}));

const MAPS = {
    tempo: [{ startSeconds: 0, beatsPerMinute: 120 }],
    timeSignature: [{ startSeconds: 0, numerator: 4, denominator: 4 }],
    loopRegion: { enabled: true, startSeconds: 2, endSeconds: 6 },
};

/**
 * The exact payload `engine_transport_set_maps` answers with. Pinned against
 * the Rust type in `crates/sourdaw-native/src/commands/engine_transport.rs`,
 * because the mirror is hand-maintained on both sides.
 */
const NATIVE_APPLIED = {
    sampleRate: 48_000,
    tempoSegments: 1,
    timeSignatureSegments: 1,
    loopEnabled: true,
};

describe('setEngineTransportMaps', () => {
    beforeEach(() => {
        vi.mocked(isDesktopRuntime).mockReturnValue(true);
        vi.mocked(desktopInvoke).mockReset();
    });

    it('sends the maps under the argument name the command expects, and reports what landed', async () => {
        vi.mocked(desktopInvoke).mockResolvedValue(NATIVE_APPLIED);

        await expect(setEngineTransportMaps(MAPS)).resolves.toEqual({
            outcome: 'applied',
            applied: NATIVE_APPLIED,
        });
        // The named argument is what the positional converter reads; a
        // differently named one arrives at the addon as a missing payload.
        expect(desktopInvoke).toHaveBeenCalledWith('engine_transport_set_maps', { maps: MAPS });
    });

    it('declines a response that does not say what the engine applied', async () => {
        // A stale desktop build answering an older shape must not be read as a
        // successful install: the caller would believe the arrangement's tempo
        // reached an engine still counting at its own default.
        vi.mocked(desktopInvoke).mockResolvedValue({ sampleRate: 48_000, tempoSegments: 'one' });

        await expect(setEngineTransportMaps(MAPS)).resolves.toEqual({
            outcome: 'declined',
            reason: 'the engine did not report what it applied',
        });
    });

    it('declines with the bridge’s own reason rather than throwing into the caller', async () => {
        // The caller is a play gesture. A rejected install is an engine
        // without maps, not a play button that fails.
        vi.mocked(desktopInvoke).mockRejectedValue(new Error('no native engine is running'));

        await expect(setEngineTransportMaps(MAPS)).resolves.toEqual({
            outcome: 'declined',
            reason: 'no native engine is running',
        });
    });

    it('declines in a browser build without reaching the bridge', async () => {
        vi.mocked(isDesktopRuntime).mockReturnValue(false);

        await expect(setEngineTransportMaps(MAPS)).resolves.toEqual({
            outcome: 'declined',
            reason: 'no desktop runtime',
        });
        expect(desktopInvoke).not.toHaveBeenCalled();
    });
});
