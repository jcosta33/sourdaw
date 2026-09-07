/**
 * Abandoning a native session the engine itself has stopped rendering for
 * (#3635, ADR 0044).
 *
 * The gate release, the writer and feed shutdown, the handle drop, and the
 * notice are all proven here against the real function; the mocks below
 * stand in only for the leaves it calls into, mirroring
 * `nativeLiveGraphSession.spec.ts`'s own doubles for the same modules.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type AudioGraphBackend } from '../../../models/AudioGraphBackend';
import { abandonNativeLiveGraphSession } from '../abandonNativeLiveGraphSession';
import { type LiveAutomationWriterPass, nativeLiveAutomationWriter } from '../nativeLiveAutomationWriterState';
import { nativeLiveGraphSession } from '../nativeLiveGraphSessionState';
import { type LiveMidiWriterPass, nativeLiveMidiWriter } from '../nativeLiveMidiWriterState';

const mocks = vi.hoisted(() => ({
    stopPlayheadFeed: vi.fn(),
    setNativeCarriedTracks: vi.fn<(trackIds: ReadonlySet<string>) => void>(),
    notifyUser: vi.fn<(message: string, level: string) => void>(),
    warn: vi.fn(),
}));

vi.mock('../startNativeEnginePlayheadFeed', () => ({ startNativeEnginePlayheadFeed: vi.fn() }));
vi.mock('../stopNativeEnginePlayheadFeed', () => ({
    stopNativeEnginePlayheadFeed: () => mocks.stopPlayheadFeed(),
}));
vi.mock('../../trackAudioControls/setNativeCarriedTracks', () => ({
    setNativeCarriedTracks: (trackIds: ReadonlySet<string>) => mocks.setNativeCarriedTracks(trackIds),
}));
vi.mock('#/utils/Notification/notifyUser', () => ({
    notifyUser: (message: string, level: string) => mocks.notifyUser(message, level),
}));
vi.mock('#/infra/logger/appLogger', () => ({
    logger: { error: vi.fn(), warn: mocks.warn, info: vi.fn(), debug: vi.fn() },
}));

/** A minimal armed midi pass — only `pass` and `epoch` are read by this spec. */
function armedMidiPass(): LiveMidiWriterPass {
    return {
        stripTracks: [],
        carriedStripIds: new Set(),
        sampleRate: 48_000,
        probabilitySeed: 0,
        entrySeconds: 0,
        looping: false,
        loopRegion: null,
        lastClearedBeforeSeconds: 0,
        refusalReported: false,
        targets: [],
    };
}

/** A minimal armed automation pass — only `pass` and `epoch` are read by this spec. */
function armedAutomationPass(): LiveAutomationWriterPass {
    return {
        stripTracks: [],
        sampleRate: 48_000,
        programmeEndSeconds: 0,
        entrySeconds: 0,
        provenAfterBatch: null,
        looping: false,
        targets: [],
        loopTargets: null,
        lastLoopWraps: null,
        wrapFloorFrame: null,
        standingRefusalReported: false,
        saturatedGroups: new Set(),
    };
}

function fakeBackend(): AudioGraphBackend & { dispose: ReturnType<typeof vi.fn<() => void>> } {
    return {
        backendId: 'stub-backend',
        apply: vi.fn<AudioGraphBackend['apply']>(),
        dispose: vi.fn<() => void>(),
    };
}

beforeEach(() => {
    mocks.stopPlayheadFeed.mockClear();
    mocks.setNativeCarriedTracks.mockReset();
    mocks.notifyUser.mockClear();
    mocks.warn.mockClear();
    nativeLiveGraphSession.backend = null;
    nativeLiveGraphSession.orphanedBackend = null;
    nativeLiveGraphSession.audibleCarrier = false;
    nativeLiveGraphSession.rolling = false;
    nativeLiveGraphSession.carriedStripIds = new Set(['a', 'b']);
    nativeLiveGraphSession.nativeChainByStripId = new Map([['a', ['eq']]]);
    nativeLiveMidiWriter.epoch = 0;
    nativeLiveMidiWriter.pass = null;
    nativeLiveAutomationWriter.epoch = 0;
    nativeLiveAutomationWriter.pass = null;
});

afterEach(() => {
    nativeLiveGraphSession.backend = null;
    nativeLiveGraphSession.orphanedBackend = null;
    nativeLiveMidiWriter.pass = null;
    nativeLiveAutomationWriter.pass = null;
});

describe('abandonNativeLiveGraphSession', () => {
    it('releases the carrier gate before orphaning the handle, and tells the musician once', () => {
        const backend = fakeBackend();
        nativeLiveGraphSession.backend = backend;
        nativeLiveGraphSession.audibleCarrier = true;
        nativeLiveGraphSession.rolling = true;
        const armedEpoch = 5;
        nativeLiveMidiWriter.epoch = armedEpoch;
        nativeLiveMidiWriter.pass = armedMidiPass();
        const armedAutomationEpoch = 7;
        nativeLiveAutomationWriter.epoch = armedAutomationEpoch;
        nativeLiveAutomationWriter.pass = armedAutomationPass();

        abandonNativeLiveGraphSession('the output stream stopped calling back');

        expect(mocks.setNativeCarriedTracks).toHaveBeenCalledWith(new Set());
        // The gate reopens before the handle is dropped from `backend`, per
        // ADR 0044 — a reordered release would leave a carried strip silent
        // on no carrier at all for however long the rest below takes.
        const claimOrder = mocks.setNativeCarriedTracks.mock.invocationCallOrder[0];
        const notifyOrder = mocks.notifyUser.mock.invocationCallOrder[0];
        expect(claimOrder).toBeLessThan(notifyOrder as number);

        expect(nativeLiveGraphSession.backend).toBeNull();
        expect(nativeLiveGraphSession.orphanedBackend).toBe(backend);
        expect(backend.dispose).not.toHaveBeenCalled();
        expect(nativeLiveGraphSession.audibleCarrier).toBe(false);
        expect(nativeLiveGraphSession.rolling).toBe(false);
        expect(nativeLiveGraphSession.carriedStripIds.size).toBe(0);
        expect(nativeLiveMidiWriter.pass).toBeNull();
        expect(nativeLiveMidiWriter.epoch).toBe(armedEpoch + 1);
        expect(nativeLiveAutomationWriter.pass).toBeNull();
        expect(nativeLiveAutomationWriter.epoch).toBe(armedAutomationEpoch + 1);
        expect([...nativeLiveGraphSession.nativeChainByStripId]).toEqual([]);
        expect(mocks.stopPlayheadFeed).toHaveBeenCalledTimes(1);
        expect(mocks.notifyUser).toHaveBeenCalledTimes(1);
        const [message, level] = mocks.notifyUser.mock.calls[0] as [string, string];
        expect(message).toContain('the output stream stopped calling back');
        expect(level).toBe('warning');
    });

    it('retains the handle as the orphan and does not dispose it', () => {
        const backend = fakeBackend();
        nativeLiveGraphSession.backend = backend;

        abandonNativeLiveGraphSession('the output stream stopped calling back');

        expect(backend.dispose).not.toHaveBeenCalled();
        expect(nativeLiveGraphSession.orphanedBackend).toBe(backend);
        expect(nativeLiveGraphSession.backend).toBeNull();
    });

    it('does nothing on a second call once the backend is gone', () => {
        const backend = fakeBackend();
        nativeLiveGraphSession.backend = backend;

        expect(() => {
            abandonNativeLiveGraphSession('the output stream stopped calling back');
            abandonNativeLiveGraphSession('a different reason entirely');
        }).not.toThrow();

        // The first call already nulled the handle, so the second returns at
        // the backend guard — not at a remembered notice text, which no
        // longer exists to compare against.
        expect(mocks.notifyUser).toHaveBeenCalledTimes(1);
        expect(backend.dispose).not.toHaveBeenCalled();
        expect(nativeLiveGraphSession.orphanedBackend).toBe(backend);
    });

    it('releases the carrier gate even with no session standing, and does nothing else', () => {
        nativeLiveGraphSession.backend = null;

        abandonNativeLiveGraphSession('the output stream stopped calling back');

        expect(mocks.setNativeCarriedTracks).toHaveBeenCalledWith(new Set());
        expect(mocks.notifyUser).not.toHaveBeenCalled();
        expect(mocks.stopPlayheadFeed).not.toHaveBeenCalled();
    });
});
