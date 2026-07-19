import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mocks = vi.hoisted(() => ({
    updateMarkerPosition: vi.fn(),
}));

vi.mock('../../../stores/sliceStore', () => ({
    updateMarkerPosition: mocks.updateMarkerPosition,
}));

import { debouncedUpdateMarkerPosition } from '../debouncedUpdateMarkerPosition';

describe('debouncedUpdateMarkerPosition', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        mocks.updateMarkerPosition.mockClear();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('does not write to the store before the debounce window elapses', () => {
        debouncedUpdateMarkerPosition('inst1', 'a', 100);

        vi.advanceTimersByTime(49);

        expect(mocks.updateMarkerPosition).not.toHaveBeenCalled();
    });

    it('writes the position once the debounce window elapses', () => {
        debouncedUpdateMarkerPosition('inst1', 'a', 100);

        vi.advanceTimersByTime(50);

        expect(mocks.updateMarkerPosition).toHaveBeenCalledTimes(1);
        expect(mocks.updateMarkerPosition).toHaveBeenCalledWith('inst1', 'a', 100);
    });

    it('coalesces rapid drag updates for the same marker into a single write of the latest value', () => {
        debouncedUpdateMarkerPosition('inst1', 'a', 100);
        vi.advanceTimersByTime(20);
        debouncedUpdateMarkerPosition('inst1', 'a', 150);
        vi.advanceTimersByTime(20);
        debouncedUpdateMarkerPosition('inst1', 'a', 200);

        vi.advanceTimersByTime(50);

        expect(mocks.updateMarkerPosition).toHaveBeenCalledTimes(1);
        expect(mocks.updateMarkerPosition).toHaveBeenCalledWith('inst1', 'a', 200);
    });

    it('tracks each marker id independently, flushing both on their own schedules', () => {
        debouncedUpdateMarkerPosition('inst1', 'a', 100);
        vi.advanceTimersByTime(30);
        debouncedUpdateMarkerPosition('inst1', 'b', 300);

        vi.advanceTimersByTime(20);
        // "a" has now been idle for 50ms and flushes; "b" has only been idle 20ms.
        expect(mocks.updateMarkerPosition).toHaveBeenCalledTimes(1);
        expect(mocks.updateMarkerPosition).toHaveBeenCalledWith('inst1', 'a', 100);

        vi.advanceTimersByTime(30);
        expect(mocks.updateMarkerPosition).toHaveBeenCalledTimes(2);
        expect(mocks.updateMarkerPosition).toHaveBeenCalledWith('inst1', 'b', 300);
    });

    it('keeps markers on different instances independent even with the same id', () => {
        debouncedUpdateMarkerPosition('inst1', 'a', 100);
        debouncedUpdateMarkerPosition('inst2', 'a', 500);

        vi.advanceTimersByTime(50);

        expect(mocks.updateMarkerPosition).toHaveBeenCalledTimes(2);
        expect(mocks.updateMarkerPosition).toHaveBeenCalledWith('inst1', 'a', 100);
        expect(mocks.updateMarkerPosition).toHaveBeenCalledWith('inst2', 'a', 500);
    });
});
