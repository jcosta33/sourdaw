import { describe, expect, it } from 'vitest';

import { getGestureClockSource, setGestureClockSource } from '../gestureClockSource';

const first = { getAudioTimeSeconds: () => 1, readNativeCursorBeats: () => null };
const second = { getAudioTimeSeconds: () => 2, readNativeCursorBeats: () => 3 };

describe('gestureClockSource', () => {
    it('refuses to read before a source is registered, naming the caller and the registrar', () => {
        expect(() => getGestureClockSource('probeCaller')).toThrow(
            /^probeCaller: .*setGestureClockSource\(\) from #\/app\/bootstrap/
        );
    });

    it('hands back the registered source', () => {
        setGestureClockSource(first);

        expect(getGestureClockSource('probeCaller')).toBe(first);
    });

    it('replaces the registered source on a second fill', () => {
        setGestureClockSource(second);

        expect(getGestureClockSource('probeCaller')).toBe(second);
    });
});
