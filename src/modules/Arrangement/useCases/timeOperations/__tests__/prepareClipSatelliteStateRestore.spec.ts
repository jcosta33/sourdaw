import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type WarpState } from '../../../models/WarpMarker';
import { isDefaultWarpState } from '../../../stores/warpStates';
import { prepareClipSatelliteStateRestore } from '../prepareClipSatelliteStateRestore';

const mocks = vi.hoisted(() => {
    // The stand-in store `publish` verifies against: reads return whatever was
    // last written, starting empty, so `apply` and `revert` observe their own
    // writes the way the live gain-envelope and warp stores do.
    const warpStatesByClipId = new Map<string, WarpState | null>();
    return {
        warpStatesByClipId,
        readClipSatelliteEntry: vi.fn((clipId: string) => {
            const stored = warpStatesByClipId.get(clipId);
            return {
                clipId,
                gainEnvelope: null,
                // Models the real read's default-collapse: a stored state equal
                // to `defaultWarpState` reads as no satellite, exactly as
                // `readClipSatelliteEntry` returns it.
                warpState: stored !== undefined && stored !== null && !isDefaultWarpState(stored) ? stored : null,
            };
        }),
        writeClipSatelliteEntry: vi.fn((entry: { clipId: string; warpState: WarpState | null }) => {
            warpStatesByClipId.set(entry.clipId, entry.warpState);
        }),
    };
});

vi.mock('../../../stores/clipSatelliteState', () => ({
    readClipSatelliteEntry: mocks.readClipSatelliteEntry,
    writeClipSatelliteEntry: mocks.writeClipSatelliteEntry,
}));

const canonicalWarpState: WarpState = {
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

    it('collapses a recorded default-content legacy warp state so the restore replays over an absent clip', () => {
        // A plan recorded by an older head captured a clip whose warp entry
        // still carried the retired `texture` mode over otherwise default
        // content. Decoded, that value is exactly `defaultWarpState`, which
        // both the live read and the guarded write treat as absent — so
        // validation must apply the same collapse, or the expected side can
        // never equal the live null read and the replay refuses forever.
        const transaction = prepareClipSatelliteStateRestore({
            version: 1,
            expected: {
                version: 1,
                entries: [
                    {
                        clipId: 'clip-1',
                        gainEnvelope: null,
                        warpState: { enabled: false, markers: [], stretchMode: 'texture', originalTempo: null },
                    },
                ],
            },
            replacement: {
                version: 1,
                entries: [
                    {
                        clipId: 'clip-1',
                        gainEnvelope: null,
                        warpState: {
                            enabled: true,
                            markers: [{ id: 'marker-1', originalBeat: 0, warpedBeat: 4 }],
                            stretchMode: 'repitch',
                            originalTempo: 120,
                        },
                    },
                ],
            },
        });

        expect(transaction.status).toBe('ready');
        expect(transaction.hasChanges).toBe(true);

        expect(transaction.apply()).toBe(true);
        expect(mocks.writeClipSatelliteEntry).toHaveBeenLastCalledWith({
            clipId: 'clip-1',
            gainEnvelope: null,
            warpState: {
                enabled: true,
                markers: [{ id: 'marker-1', originalBeat: 0, warpedBeat: 4 }],
                stretchMode: 'repitch',
                originalTempo: 120,
            },
        });

        expect(transaction.revert()).toBe(true);
        // The revert restores the collapsed form, never the raw legacy
        // default content the expected side was recorded with.
        expect(mocks.writeClipSatelliteEntry).toHaveBeenLastCalledWith({
            clipId: 'clip-1',
            gainEnvelope: null,
            warpState: null,
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
