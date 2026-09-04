import { beforeEach, describe, expect, it, vi } from 'vitest';

import { desktopInvoke, isDesktopRuntime } from '#/utils/desktopBridge';

import { getEngineTransportPosition } from '../getEngineTransportPosition';

vi.mock('#/utils/desktopBridge', () => ({
    desktopInvoke: vi.fn(),
    isDesktopRuntime: vi.fn(() => true),
}));

/**
 * The exact payload `engine_transport_position` emits. Pinned against the Rust
 * wire-shape test in `crates/sourdaw-native/src/commands/engine_transport.rs`,
 * because the mirror type is hand-maintained on both sides.
 */
const NATIVE_PAYLOAD = {
    running: true,
    playing: true,
    positionSeconds: 1.5,
    playheadFrame: 72_000,
    loopWraps: 2,
    batchesApplied: 11,
    tempo: 128,
    timeSigNum: 5,
    timeSigDenom: 4,
};

describe('getEngineTransportPosition', () => {
    beforeEach(() => {
        vi.mocked(isDesktopRuntime).mockReturnValue(true);
        vi.mocked(desktopInvoke).mockReset();
    });

    it('reads the native payload onto its own fields', async () => {
        vi.mocked(desktopInvoke).mockResolvedValue(NATIVE_PAYLOAD);

        await expect(getEngineTransportPosition()).resolves.toEqual(NATIVE_PAYLOAD);
        expect(desktopInvoke).toHaveBeenCalledWith('engine_transport_position');
    });

    it('reports the stopped shape in a browser build without reaching the bridge', async () => {
        vi.mocked(isDesktopRuntime).mockReturnValue(false);

        const position = await getEngineTransportPosition();

        expect(position.running).toBe(false);
        expect(position.playing).toBe(false);
        expect(desktopInvoke).not.toHaveBeenCalled();
    });

    it('reads a missing or non-numeric field as zero rather than as a position', async () => {
        // A cursor drawn from `NaN` or `undefined` disappears; a stale build
        // answering an older shape must degrade to the song start instead.
        vi.mocked(desktopInvoke).mockResolvedValue({ running: true, playing: true, positionSeconds: 'soon' });

        const position = await getEngineTransportPosition();

        expect(position.running).toBe(true);
        expect(position.positionSeconds).toBe(0);
        expect(position.loopWraps).toBe(0);
        expect(position.batchesApplied).toBe(0);
    });
});
