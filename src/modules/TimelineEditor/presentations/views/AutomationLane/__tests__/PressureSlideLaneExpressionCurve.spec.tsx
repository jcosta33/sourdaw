/**
 * Renders the real `PressureLane` and `SlideLane` — with the real
 * `NotePropertyLane` beneath them, not the stub `PressureLane.spec.tsx` and
 * `SlideLane.spec.tsx` install — so the `getCurve` prop each lane wires is
 * observed actually reaching the canvas draw, not just passed to a mock.
 */
import { render } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import { PressureLane } from '../PressureLane';
import { SlideLane } from '../SlideLane';

type LaneNote = {
    id: string;
    pitch: number;
    startBeat: number;
    duration: number;
    velocity: number;
    expression?: {
        pressure?: { offsetBeats: number; value: number }[];
        slide?: { offsetBeats: number; value: number }[];
    };
};

const laneMocks = vi.hoisted(() => {
    const notesByClipId: Record<string, LaneNote[]> = {};
    return { midiState: { notesByClipId } };
});

vi.mock('#/modules/MIDI/stores', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/MIDI/stores')>()),
    midiStore: {
        get value() {
            return laneMocks.midiState;
        },
    },
}));

vi.mock('#/modules/Arrangement/stores', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Arrangement/stores')>()),
    trackStore: { value: { tracks: [] } },
}));

vi.mock('#/modules/Command/useCases', () => ({
    executeUserAppAction: vi.fn(),
    pushUndoEntry: vi.fn(),
}));

vi.mock('#/modules/MIDI/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/MIDI/useCases')>()),
    setNotePressure: vi.fn(),
    setNoteSlide: vi.fn(),
}));

vi.mock('#/utils/UI/resolveToken', () => ({
    resolveToken: vi.fn(() => '#151515'),
}));

vi.mock('../../../helpers/oklchColor', () => ({
    colorWithAlpha: vi.fn((color: string) => color),
    brightenColor: vi.fn((color: string) => color),
}));

vi.mock('#/infra/store/useStore', () => ({
    useStore: vi.fn(<TData,>(store: { value: TData | null }, fallback?: TData) => store.value ?? fallback),
}));

const scrollContainer = (): { current: HTMLElement } => {
    const element = document.createElement('div');
    Object.defineProperty(element, 'clientWidth', { value: 200, configurable: true });
    Object.defineProperty(element, 'scrollLeft', { value: 0, writable: true, configurable: true });
    return { current: element };
};

// Shared jsdom 2d-context stub — the same object serves every canvas.
const ctx2d = document.createElement('canvas').getContext('2d')!;

describe('PressureLane and SlideLane draw their real recorded expression curve', () => {
    let rectSpy: { mockRestore: () => void };

    beforeEach(() => {
        vi.clearAllMocks();
        laneMocks.midiState = { notesByClipId: {} };
        rectSpy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 200, 131));
    });

    afterEach(() => {
        rectSpy.mockRestore();
    });

    it('draws the recorded pressure curve through PressureLane', () => {
        laneMocks.midiState = {
            notesByClipId: {
                'clip-1': [
                    {
                        id: 'n1',
                        pitch: 60,
                        startBeat: 0,
                        duration: 4,
                        velocity: 100,
                        expression: { pressure: [{ offsetBeats: 1, value: 90 }] },
                    },
                ],
            },
        };
        const lineTo = vi.spyOn(ctx2d, 'lineTo');
        lineTo.mockClear();

        render(
            <PressureLane
                clipId="clip-1"
                trackId="track-1"
                selectedNoteIds={new Set()}
                beatWidth={40}
                scrollRef={scrollContainer()}
            />
        );

        // strokeNoteCurve is only reached when NotePropertyLane's getCurve returns a
        // non-empty curve — proof PressureLane's getCurve prop actually wired through.
        expect(lineTo).toHaveBeenCalled();
    });

    it('draws the recorded slide curve through SlideLane', () => {
        laneMocks.midiState = {
            notesByClipId: {
                'clip-1': [
                    {
                        id: 'n1',
                        pitch: 60,
                        startBeat: 0,
                        duration: 4,
                        velocity: 100,
                        expression: { slide: [{ offsetBeats: 2, value: 40 }] },
                    },
                ],
            },
        };
        const lineTo = vi.spyOn(ctx2d, 'lineTo');
        lineTo.mockClear();

        render(
            <SlideLane
                clipId="clip-1"
                trackId="track-1"
                selectedNoteIds={new Set()}
                beatWidth={40}
                scrollRef={scrollContainer()}
            />
        );

        expect(lineTo).toHaveBeenCalled();
    });
});
