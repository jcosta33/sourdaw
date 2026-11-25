import { beforeEach, describe, expect, it, vi } from 'vitest';

type SourceModule = typeof import('../gestureClockSource');

describe('gestureClockSource', () => {
    let getSource: SourceModule['getGestureClockSource'];
    let setSource: SourceModule['setGestureClockSource'];

    beforeEach(async () => {
        // A fresh module graph holds an unfilled source; the shared spec fixture only fills the first one.
        vi.resetModules();
        const module = await import('../gestureClockSource');
        getSource = module.getGestureClockSource;
        setSource = module.setGestureClockSource;
    });

    it('throws naming the source, the fill and its registrar while none is registered', () => {
        expect(() => getSource()).toThrow('getGestureClockSource: no gesture clock source is registered');
        expect(() => getSource()).toThrow(
            'setGestureClockSource() from configureDeviceControlDependencies() in src/app/bootstrap.ts'
        );
    });

    it('returns the registered clock reads', () => {
        const source = { getAudioTimeSeconds: vi.fn(() => 2.5), readNativeCursorBeats: vi.fn(() => 8) };
        setSource(source);

        expect(getSource()).toBe(source);
        expect(getSource().getAudioTimeSeconds()).toBe(2.5);
        expect(getSource().readNativeCursorBeats()).toBe(8);
    });

    it('a second fill replaces the first', () => {
        const first = { getAudioTimeSeconds: () => 1, readNativeCursorBeats: () => null };
        const second = { getAudioTimeSeconds: () => 2, readNativeCursorBeats: () => null };
        setSource(first);
        setSource(second);

        expect(getSource()).toBe(second);
    });
});
