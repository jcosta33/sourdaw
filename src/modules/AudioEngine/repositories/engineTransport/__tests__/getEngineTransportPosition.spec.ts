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
    captureClock: null,
    captureClockQuery: null,
    running: true,
    playing: true,
    positionSeconds: 1.5,
    playheadFrame: 72_000,
    loopWraps: 2,
    batchesApplied: 11,
    tempo: 128,
    timeSigNum: 5,
    timeSigDenom: 4,
    masterPeak: 0.5,
    stripPeaks: { 'strip-a': 0.25, 'strip-b': 0.75 },
    tunerTelemetry: {
        'd-tuner': {
            active: true,
            frequency: 440.5,
            cents: -2.5,
            confidence: 0.75,
            noteIndex: 9,
            octave: 4,
            midiNote: 69,
        },
    },
};

describe('getEngineTransportPosition', () => {
    beforeEach(() => {
        vi.mocked(isDesktopRuntime).mockReturnValue(true);
        vi.mocked(desktopInvoke).mockReset();
    });

    it.each(['estimated', 'degraded'] as const)(
        'retains a %s callback presentation date independently of a later query bracket',
        async (quality) => {
            const captureClock = {
                epoch: 7,
                streamEpoch: 2,
                sampleRate: 48000,
                presentationSeconds: 12.25,
                quality,
                uncertaintySeconds: null,
            };
            const captureClockQuery = { epoch: 7, enteredSeconds: 12.3, leavingSeconds: 12.35 };
            vi.mocked(desktopInvoke).mockResolvedValue({ ...NATIVE_PAYLOAD, captureClock, captureClockQuery });

            const position = await getEngineTransportPosition();

            expect(position).toMatchObject({ captureClock, captureClockQuery });
        }
    );

    it.each([
        { captureClock: undefined, captureClockQuery: undefined },
        {
            captureClock: {
                epoch: 1,
                streamEpoch: 1,
                sampleRate: 0,
                presentationSeconds: 1,
                quality: 'estimated',
                uncertaintySeconds: null,
            },
            captureClockQuery: { epoch: 1, enteredSeconds: 2, leavingSeconds: 3 },
        },
        {
            captureClock: {
                epoch: 1,
                streamEpoch: 1,
                sampleRate: 48000,
                presentationSeconds: Number.NaN,
                quality: 'estimated',
                uncertaintySeconds: null,
            },
            captureClockQuery: { epoch: 1, enteredSeconds: 2, leavingSeconds: 3 },
        },
        {
            captureClock: {
                epoch: 1,
                streamEpoch: 1,
                sampleRate: 48000,
                presentationSeconds: 1,
                quality: 'exact',
                uncertaintySeconds: null,
            },
            captureClockQuery: { epoch: 1, enteredSeconds: 2, leavingSeconds: 3 },
        },
        {
            captureClock: {
                epoch: 1,
                streamEpoch: 1,
                sampleRate: 48000,
                presentationSeconds: 1,
                quality: 'estimated',
                uncertaintySeconds: -1,
            },
            captureClockQuery: { epoch: 1, enteredSeconds: 2, leavingSeconds: 3 },
        },
        {
            captureClock: {
                epoch: 1,
                streamEpoch: 1,
                sampleRate: 48000,
                presentationSeconds: 1,
                quality: 'estimated',
                uncertaintySeconds: null,
            },
            captureClockQuery: { epoch: 2, enteredSeconds: 2, leavingSeconds: 3 },
        },
        {
            captureClock: {
                epoch: 1,
                streamEpoch: 1,
                sampleRate: 48000,
                presentationSeconds: 1,
                quality: 'estimated',
                uncertaintySeconds: null,
            },
            captureClockQuery: { epoch: 1, enteredSeconds: 3, leavingSeconds: 2 },
        },
    ])('keeps unusable capture timing unavailable without changing cursor fields (%#)', async (timing) => {
        vi.mocked(desktopInvoke).mockResolvedValue({ ...NATIVE_PAYLOAD, ...timing });
        const position = await getEngineTransportPosition();
        expect(position.captureClock).toBeNull();
        expect(position.positionSeconds).toBe(NATIVE_PAYLOAD.positionSeconds);
        expect(position.batchesApplied).toBe(NATIVE_PAYLOAD.batchesApplied);
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
        expect(position.masterPeak).toBe(0);
        expect(position.stripPeaks).toEqual({});
        expect(position.tunerTelemetry).toEqual({});
    });

    it('keeps only finite-number strip peaks, on their own keys', async () => {
        vi.mocked(desktopInvoke).mockResolvedValue({
            running: true,
            playing: true,
            stripPeaks: { 'strip-a': 0.25, 'strip-b': 'loud', 'strip-c': Number.NaN, 'strip-d': null },
        });

        const position = await getEngineTransportPosition();

        expect(position.stripPeaks).toEqual({ 'strip-a': 0.25 });
    });

    it('reports no strip peaks when the field is missing or not an object', async () => {
        vi.mocked(desktopInvoke).mockResolvedValue({ running: true, playing: true, stripPeaks: 'not-an-object' });

        const position = await getEngineTransportPosition();

        expect(position.stripPeaks).toEqual({});
    });

    // An inactive reading is a reading: a tuner that has stopped hearing a
    // note publishes `active: false`, and the panel has to show that rather
    // than hold the last pitch it saw. So it survives the read like any other.
    it('keeps a well-formed tuner reading, active or not, on its own key', async () => {
        vi.mocked(desktopInvoke).mockResolvedValue({
            running: true,
            playing: true,
            tunerTelemetry: {
                'd-heard': {
                    active: true,
                    frequency: 440.5,
                    cents: -2.5,
                    confidence: 0.75,
                    noteIndex: 9,
                    octave: 4,
                    midiNote: 69,
                },
                'd-silent': {
                    active: false,
                    frequency: 0,
                    cents: 0,
                    confidence: 0,
                    noteIndex: 0,
                    octave: 0,
                    midiNote: 0,
                },
            },
        });

        const position = await getEngineTransportPosition();

        expect(position.tunerTelemetry).toEqual({
            'd-heard': {
                active: true,
                frequency: 440.5,
                cents: -2.5,
                confidence: 0.75,
                noteIndex: 9,
                octave: 4,
                midiNote: 69,
            },
            'd-silent': {
                active: false,
                frequency: 0,
                cents: 0,
                confidence: 0,
                noteIndex: 0,
                octave: 0,
                midiNote: 0,
            },
        });
    });

    // Dropped whole rather than filled in: a reading missing a field, or
    // carrying a non-finite or wrongly typed one, would put a number in front
    // of the musician that no analyser computed, and the needle could not say
    // which of its fields it made up.
    it('drops a malformed tuner reading rather than coercing it', async () => {
        vi.mocked(desktopInvoke).mockResolvedValue({
            running: true,
            playing: true,
            tunerTelemetry: {
                'd-ok': {
                    active: true,
                    frequency: 440,
                    cents: 0,
                    confidence: 1,
                    noteIndex: 9,
                    octave: 4,
                    midiNote: 69,
                },
                'd-no-flag': {
                    active: 1,
                    frequency: 440,
                    cents: 0,
                    confidence: 1,
                    noteIndex: 9,
                    octave: 4,
                    midiNote: 69,
                },
                'd-nan': {
                    active: true,
                    frequency: Number.NaN,
                    cents: 0,
                    confidence: 1,
                    noteIndex: 9,
                    octave: 4,
                    midiNote: 69,
                },
                'd-short': { active: true, frequency: 440, cents: 0 },
                'd-not-an-object': 440,
            },
        });

        const position = await getEngineTransportPosition();

        expect(Object.keys(position.tunerTelemetry)).toEqual(['d-ok']);
    });

    it('reports no tuner readings when the field is missing or not an object', async () => {
        vi.mocked(desktopInvoke).mockResolvedValue({
            running: true,
            playing: true,
            tunerTelemetry: 'not-an-object',
        });

        const position = await getEngineTransportPosition();

        expect(position.tunerTelemetry).toEqual({});
    });
});
