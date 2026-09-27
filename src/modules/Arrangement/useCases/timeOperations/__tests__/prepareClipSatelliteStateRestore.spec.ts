import { beforeEach, describe, expect, it, vi } from 'vitest';

import { prepareClipSatelliteStateRestore } from '../prepareClipSatelliteStateRestore';

const mocks = vi.hoisted(() => {
    // The stand-in store `publish` verifies against: reads return whatever was
    // last written, starting empty, so `apply` and `revert` observe their own
    // writes the way the live gain-envelope and warp stores do.
    const warpStatesByClipId = new Map<string, unknown>();
    return {
        warpStatesByClipId,
        readClipSatelliteEntry: vi.fn((clipId: string) => ({
            clipId,
            gainEnvelope: null,
            warpState: warpStatesByClipId.get(clipId) ?? null,
        })),
        writeClipSatelliteEntry: vi.fn((entry: { clipId: string; warpState: unknown }) => {
            warpStatesByClipId.set(entry.clipId, entry.warpState);
        }),
    };
});

vi.mock('../../../stores/clipSatelliteState', () => ({
    readClipSatelliteEntry: mocks.readClipSatelliteEntry,
    writeClipSatelliteEntry: mocks.writeClipSatelliteEntry,
}));

const canonicalWarpState = {
    enabled: true,
    markers: [],
    stretchMode: 'phase-vocoder',
    originalTempo: 120,
};

const legacyWarpState = {
    enabled: true,
    markers: [],
    stretchMode: 'complex',
    originalTempo: 120,
};

function planWithExpectedWarpState(warpState: unknown) {
    return {
        version: 1,
        expected: {
            version: 1,
            entries: [{ clipId: 'clip-1', gainEnvelope: null, warpState }],
        },
        replacement: {
            version: 1,
            entries: [{ clipId: 'clip-1', gainEnvelope: null, warpState: null }],
        },
    };
}

describe('prepareClipSatelliteStateRestore', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.warpStatesByClipId.clear();
    });

    it('accepts a legacy stretch mode in the plan and restores its mapped canonical mode', () => {
        // An undo plan serialized before the pre-ADR 0024 modes were retired
        // still carries `complex`. The acceptance path maps it onto the
        // canonical vocabulary at validation, so the restore replays in
        // canonical terms instead of refusing the whole plan — and the revert
        // writes the mapped mode back, never the legacy id.
        mocks.warpStatesByClipId.set('clip-1', canonicalWarpState);
        const transaction = prepareClipSatelliteStateRestore(planWithExpectedWarpState(legacyWarpState));

        expect(transaction.status).toBe('ready');
        expect(transaction.hasChanges).toBe(true);

        expect(transaction.apply()).toBe(true);
        expect(mocks.writeClipSatelliteEntry).toHaveBeenCalledWith({
            clipId: 'clip-1',
            gainEnvelope: null,
            warpState: null,
        });

        expect(transaction.revert()).toBe(true);
        expect(mocks.writeClipSatelliteEntry).toHaveBeenLastCalledWith({
            clipId: 'clip-1',
            gainEnvelope: null,
            warpState: canonicalWarpState,
        });
    });

    it('accepts a canonical stretch mode unchanged', () => {
        mocks.warpStatesByClipId.set('clip-1', canonicalWarpState);
        const transaction = prepareClipSatelliteStateRestore(planWithExpectedWarpState(canonicalWarpState));

        expect(transaction.status).toBe('ready');
        expect(transaction.hasChanges).toBe(true);
        expect(transaction.apply()).toBe(true);
        expect(transaction.revert()).toBe(true);
        expect(mocks.writeClipSatelliteEntry).toHaveBeenLastCalledWith({
            clipId: 'clip-1',
            gainEnvelope: null,
            warpState: canonicalWarpState,
        });
    });

    it('rejects a stretch mode that never was a warp mode without writing', () => {
        const transaction = prepareClipSatelliteStateRestore(
            planWithExpectedWarpState({ ...canonicalWarpState, stretchMode: 'not-a-mode' })
        );

        expect(transaction.status).toBe('rejected');
        expect(transaction.hasChanges).toBe(false);
        expect(transaction.apply()).toBe(false);
        expect(mocks.writeClipSatelliteEntry).not.toHaveBeenCalled();
    });
});
