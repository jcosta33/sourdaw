import { describe, it, expect, vi, beforeEach } from 'vitest';

import { maybeRecordAutomation } from '../maybeRecordAutomation';

type Deps = Parameters<typeof maybeRecordAutomation>[0];
type TransportSnapshot = ReturnType<Deps['getTransportValue']>;

/**
 * A mixer gesture must be stamped at the beat the *moving* transport stood on
 * when the sample was taken (#3799). The transport store is written on discrete
 * transitions only, so during playback it keeps the beat playback started at —
 * recording from it collapses a whole fader ride onto the start beat. The beat
 * arrives through the injected `getGestureBeat` (backed by Transport's
 * `captureGestureBeat` in production), never through the store.
 */
describe('maybeRecordAutomation', () => {
    const recordAutomationValue = vi.fn<Deps['recordAutomationValue']>();
    const getGestureBeat = vi.fn<Deps['getGestureBeat']>();

    function makeDeps(
        track: { id: string; automationMode: string } | null,
        transport: { isPlaying: boolean; playheadPosition: number }
    ): Deps {
        return {
            getTransportValue: () => transport as TransportSnapshot,
            getGestureBeat,
            getTrackById: () => track as ReturnType<Deps['getTrackById']>,
            recordAutomationValue,
        };
    }

    beforeEach(() => {
        recordAutomationValue.mockClear();
        getGestureBeat.mockReset();
        getGestureBeat.mockReturnValue(7.5);
    });

    it('records the sample at the gesture beat while the store still holds the playback-start beat', () => {
        maybeRecordAutomation(
            makeDeps({ id: 't1', automationMode: 'latch' }, { isPlaying: true, playheadPosition: 0 }),
            't1',
            'gain',
            0.8
        );

        expect(recordAutomationValue).toHaveBeenCalledWith('t1', 'gain', 0.8, 7.5);
    });

    it('does not record while the transport is parked', () => {
        maybeRecordAutomation(
            makeDeps({ id: 't1', automationMode: 'latch' }, { isPlaying: false, playheadPosition: 7.5 }),
            't1',
            'gain',
            0.8
        );

        expect(recordAutomationValue).not.toHaveBeenCalled();
    });

    it('does not record a write that declares itself a static edit', () => {
        maybeRecordAutomation(
            makeDeps({ id: 't1', automationMode: 'latch' }, { isPlaying: true, playheadPosition: 0 }),
            't1',
            'gain',
            0.8,
            { automationRecordingPolicy: 'suppressed' }
        );

        expect(recordAutomationValue).not.toHaveBeenCalled();
    });

    it('does not record outside the recording modes', () => {
        maybeRecordAutomation(
            makeDeps({ id: 't1', automationMode: 'read' }, { isPlaying: true, playheadPosition: 0 }),
            't1',
            'gain',
            0.8
        );

        expect(recordAutomationValue).not.toHaveBeenCalled();
    });

    it('records nothing when the track cannot be found', () => {
        maybeRecordAutomation(makeDeps(null, { isPlaying: true, playheadPosition: 0 }), 't1', 'gain', 0.8);

        expect(recordAutomationValue).not.toHaveBeenCalled();
    });
});
