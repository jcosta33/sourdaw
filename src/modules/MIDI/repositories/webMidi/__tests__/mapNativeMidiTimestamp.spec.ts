import { beforeEach, describe, expect, it } from 'vitest';

import { mapNativeMidiTimestamp } from '../mapNativeMidiTimestamp';
import { resetNativeMidiTimeAnchor } from '../resetNativeMidiTimeAnchor';
import { webMidiRuntime } from '../state';

const MICROS = 1000;

describe('mapNativeMidiTimestamp', () => {
    beforeEach(() => {
        resetNativeMidiTimeAnchor();
    });

    it('returns undefined without a native stamp, leaving the caller on "read the clock now"', () => {
        expect(mapNativeMidiTimestamp({ timestampMicros: undefined, receivedAtMs: 100 })).toBeUndefined();
        expect(mapNativeMidiTimestamp({ timestampMicros: Number.NaN, receivedAtMs: 100 })).toBeUndefined();
        expect(mapNativeMidiTimestamp({ timestampMicros: Infinity, receivedAtMs: 100 })).toBeUndefined();
        expect(webMidiRuntime.nativeMidiTimeAnchorMs).toBeNull();
    });

    it('anchors on the first message and reports it as arriving now', () => {
        const mapped = mapNativeMidiTimestamp({ timestampMicros: 700 * MICROS, receivedAtMs: 1000 });

        expect(mapped).toBe(1000);
        expect(webMidiRuntime.nativeMidiTimeAnchorMs).toBe(300);
    });

    it('preserves the gap between two messages rather than the gap between two handler runs', () => {
        mapNativeMidiTimestamp({ timestampMicros: 700 * MICROS, receivedAtMs: 1000 });

        // Played 40ms later, but the handler ran 250ms later.
        const mapped = mapNativeMidiTimestamp({ timestampMicros: 740 * MICROS, receivedAtMs: 1250 });

        expect(mapped).toBe(1040);
    });

    it('lowers the anchor when a message arrives with less delay than any before it', () => {
        // First message was itself held up 300ms, so the anchor starts too high.
        mapNativeMidiTimestamp({ timestampMicros: 700 * MICROS, receivedAtMs: 1000 });
        expect(webMidiRuntime.nativeMidiTimeAnchorMs).toBe(300);

        // This one got through in 10ms and sees the clocks more clearly.
        const mapped = mapNativeMidiTimestamp({ timestampMicros: 800 * MICROS, receivedAtMs: 810 });

        expect(webMidiRuntime.nativeMidiTimeAnchorMs).toBe(10);
        expect(mapped).toBe(810);
    });

    it('never reports a message as having arrived after the moment it was received', () => {
        mapNativeMidiTimestamp({ timestampMicros: 700 * MICROS, receivedAtMs: 1000 });

        const receivedAtMs = 1100;
        const mapped = mapNativeMidiTimestamp({ timestampMicros: 790 * MICROS, receivedAtMs });

        expect(mapped).toBeLessThanOrEqual(receivedAtMs);
    });

    it('re-anchors instead of returning a stamp the arrival-time guard would refuse', () => {
        mapNativeMidiTimestamp({ timestampMicros: 700 * MICROS, receivedAtMs: 1000 });

        // Clocks have drifted apart (or the device epoch moved): this message
        // read through the old anchor would imply a 4s wait, well past what the
        // guard treats as scheduling delay. Being refused would silently drop
        // us back to reading the clock at handler-run time.
        const receivedAtMs = 6000;
        const mapped = mapNativeMidiTimestamp({ timestampMicros: 1700 * MICROS, receivedAtMs });

        expect(mapped).toBe(receivedAtMs);
        expect(webMidiRuntime.nativeMidiTimeAnchorMs).toBe(4300);
    });

    it('keeps a credible wait mapped rather than re-anchoring on it', () => {
        mapNativeMidiTimestamp({ timestampMicros: 700 * MICROS, receivedAtMs: 1000 });

        // 900ms is a bad day for the event loop, but still inside the window.
        const mapped = mapNativeMidiTimestamp({ timestampMicros: 1000 * MICROS, receivedAtMs: 2200 });

        expect(mapped).toBe(1300);
        expect(webMidiRuntime.nativeMidiTimeAnchorMs).toBe(300);
    });
});
