import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { YeastPreviewSnapshot } from '../../models/YeastPreviewSnapshot';

/**
 * subscribeYeastPreview wires a UI presenter to the preview tap. Domain intent:
 *  - Enable capture for the scope on subscribe; disable on dispose (balanced).
 *  - Emit an immediate sample so the presenter never waits a full frame for data.
 *  - Poll at ~30 fps (1000/30 ms) so the presenter reflects freshly captured notes.
 *  - Be idempotent: disposing twice must not disable capture twice (which would
 *    corrupt a re-subscription in the same epoch) nor leak an extra interval clear.
 *  - Stop sampling once disposed so a late interval tick does not deliver a
 *    stale snapshot to a presenter that has already torn down.
 */
const readMock = vi.hoisted(() => vi.fn<(snapshot: YeastPreviewSnapshot) => YeastPreviewSnapshot>());
const captureMock = vi.hoisted(() => vi.fn<(input: unknown) => void>());

vi.mock('../yeastSchedulingBridge/readYeastPreviewSnapshot', () => ({
    readYeastPreviewSnapshot: readMock,
}));
vi.mock('../yeastSchedulingBridge/setYeastPreviewCaptureEnabled', () => ({
    setYeastPreviewCaptureEnabled: captureMock,
}));

const { subscribeYeastPreview } = await import('../subscribeYeastPreview');

function emptySnapshot(): YeastPreviewSnapshot {
    return {
        rackId: 'rack-a',
        routeId: 'track-a',
        trackId: 'track-a',
        captureEpoch: 0,
        projectionVersion: 0,
        reset: false,
        capacity: 512,
        events: [],
        provenance: [],
        droppedEvents: 0,
    };
}

describe('subscribeYeastPreview', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        readMock.mockReset();
        captureMock.mockReset();
        readMock.mockReturnValue(emptySnapshot());
        captureMock.mockImplementation(() => undefined);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('enables capture, emits an immediate sample, then polls at ~30 fps', () => {
        const onSnapshot = vi.fn();
        subscribeYeastPreview({ rackId: 'rack-a', trackId: 'track-a', onSnapshot });

        // Capture enabled exactly once on subscribe.
        expect(captureMock).toHaveBeenCalledTimes(1);
        expect(captureMock).toHaveBeenCalledWith(expect.objectContaining({ enabled: true, trackId: 'track-a' }));

        // Immediate sample fires synchronously on subscribe (before any timer).
        expect(readMock).toHaveBeenCalledTimes(1);
        expect(onSnapshot).toHaveBeenCalledTimes(1);
        expect(onSnapshot.mock.calls[0]![1]).toBeTypeOf('number');

        // Advance ~33ms (one 30fps frame) -> a second sample.
        vi.advanceTimersByTime(1000 / 30);
        expect(onSnapshot).toHaveBeenCalledTimes(2);

        // Advance another frame -> a third sample.
        vi.advanceTimersByTime(1000 / 30);
        expect(onSnapshot).toHaveBeenCalledTimes(3);
    });

    it('defaults routeId to trackId when no route is given', () => {
        subscribeYeastPreview({ rackId: 'rack-a', trackId: 'track-a', onSnapshot: vi.fn() });

        expect(captureMock).toHaveBeenCalledWith(
            expect.objectContaining({ rackId: 'rack-a', routeId: 'track-a', trackId: 'track-a', enabled: true })
        );
        expect(readMock).toHaveBeenCalledWith(
            expect.objectContaining({ rackId: 'rack-a', routeId: 'track-a', trackId: 'track-a' })
        );
    });

    it('passes an explicit routeId through to both capture and read', () => {
        subscribeYeastPreview({ rackId: 'rack-a', routeId: 'route-x', trackId: 'track-a', onSnapshot: vi.fn() });

        expect(captureMock).toHaveBeenCalledWith(
            expect.objectContaining({ rackId: 'rack-a', routeId: 'route-x', trackId: 'track-a', enabled: true })
        );
        expect(readMock).toHaveBeenCalledWith(
            expect.objectContaining({ rackId: 'rack-a', routeId: 'route-x', trackId: 'track-a' })
        );
    });

    it('delivers the snapshot read from the tap', () => {
        const snapshot: YeastPreviewSnapshot = { ...emptySnapshot(), projectionVersion: 7 };
        readMock.mockReturnValue(snapshot);
        const onSnapshot = vi.fn();

        subscribeYeastPreview({ rackId: 'rack-a', trackId: 'track-a', onSnapshot });

        expect(onSnapshot).toHaveBeenCalledWith(snapshot, expect.any(Number));
    });

    it('disables capture and stops polling on unsubscribe', () => {
        const onSnapshot = vi.fn();
        const unsubscribe = subscribeYeastPreview({ rackId: 'rack-a', trackId: 'track-a', onSnapshot });
        expect(onSnapshot).toHaveBeenCalledTimes(1);

        unsubscribe();

        // Capture disabled exactly once on teardown.
        expect(captureMock).toHaveBeenLastCalledWith(expect.objectContaining({ enabled: false }));
        const disableCalls = captureMock.mock.calls.filter((call) => {
            const input = call[0] as { enabled: boolean };
            return input.enabled === false;
        });
        expect(disableCalls).toHaveLength(1);

        // No further samples arrive after disposal.
        vi.advanceTimersByTime((1000 / 30) * 3);
        expect(onSnapshot).toHaveBeenCalledTimes(1);
    });

    it('is idempotent: calling unsubscribe twice disables capture only once', () => {
        const unsubscribe = subscribeYeastPreview({ rackId: 'rack-a', trackId: 'track-a', onSnapshot: vi.fn() });

        unsubscribe();
        unsubscribe();

        const disableCalls = captureMock.mock.calls.filter((call) => {
            const input = call[0] as { enabled: boolean };
            return input.enabled === false;
        });
        expect(disableCalls).toHaveLength(1);
    });
});
