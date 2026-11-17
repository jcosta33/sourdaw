import { fireEvent, render } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { PianoModel3D } from '../PianoModel3D';

// hitTestKey reads canvas.width and getBoundingClientRect. jsdom reports a
// 0x0 rect, which makes the pixel mapping degenerate. Pin the rect to the
// canvas's intrinsic size so scaleX/scaleY are 1 and hit-testing is exercised
// against real key geometry.
const CANVAS_W = 800;
const CANVAS_H = 480;

// Two y/x picks that land on distinct *white* keys (below the black-key band).
const KEY_Y = 400;
const KEY_A = { x: 100, y: KEY_Y };
const KEY_B = { x: 220, y: KEY_Y };

describe('PianoModel3D', () => {
    beforeEach(() => {
        vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockReturnValue({
            left: 0,
            top: 0,
            width: CANVAS_W,
            height: CANVAS_H,
            right: CANVAS_W,
            bottom: CANVAS_H,
            x: 0,
            y: 0,
            toJSON: () => ({}),
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('should render', () => {
        const { container } = render(<PianoModel3D activeNotes={new Map()} sustainPedal={0} lidPosition={0.5} />);
        expect(container.querySelector('canvas')).toBeTruthy();
    });

    it('keeps two simultaneously pressed notes independent (multi-touch chord)', () => {
        const onNoteOn = vi.fn<(midi: number, velocity: number) => void>();
        const onNoteOff = vi.fn<(midi: number) => void>();
        const onPreviewHoldChange = vi.fn<(held: boolean) => void>();
        const { container } = render(
            <PianoModel3D
                activeNotes={new Map()}
                sustainPedal={0}
                lidPosition={0.5}
                onNoteOn={onNoteOn}
                onNoteOff={onNoteOff}
                onPreviewHoldChange={onPreviewHoldChange}
            />
        );
        const canvas = container.querySelector('canvas')!;

        // Two fingers land on two different keys.
        fireEvent.pointerDown(canvas, { pointerId: 1, clientX: KEY_A.x, clientY: KEY_A.y });
        expect(onPreviewHoldChange.mock.calls).toEqual([[true]]);
        fireEvent.pointerDown(canvas, { pointerId: 2, clientX: KEY_B.x, clientY: KEY_B.y });

        expect(onNoteOn).toHaveBeenCalledTimes(2);
        const noteA = onNoteOn.mock.calls[0]![0];
        const noteB = onNoteOn.mock.calls[1]![0];
        expect(noteA).not.toBe(noteB);

        // Lift the first finger — only its note releases; the second is held.
        fireEvent.pointerUp(canvas, { pointerId: 1, clientX: KEY_A.x, clientY: KEY_A.y });
        expect(onNoteOff).toHaveBeenCalledTimes(1);
        expect(onNoteOff).toHaveBeenCalledWith(noteA);
        expect(onPreviewHoldChange.mock.calls).toEqual([[true]]);

        // Lift the second finger — its own note releases.
        fireEvent.pointerUp(canvas, { pointerId: 2, clientX: KEY_B.x, clientY: KEY_B.y });
        expect(onNoteOff).toHaveBeenCalledTimes(2);
        expect(onNoteOff).toHaveBeenCalledWith(noteB);
        expect(onPreviewHoldChange.mock.calls).toEqual([[true], [false]]);
    });

    it('releases a held note via the window fallback when capture is a no-op', () => {
        const onNoteOn = vi.fn<(midi: number, velocity: number) => void>();
        const onNoteOff = vi.fn<(midi: number) => void>();
        const { container } = render(
            <PianoModel3D
                activeNotes={new Map()}
                sustainPedal={0}
                lidPosition={0.5}
                onNoteOn={onNoteOn}
                onNoteOff={onNoteOff}
            />
        );
        const canvas = container.querySelector('canvas')!;

        fireEvent.pointerDown(canvas, { pointerId: 7, clientX: KEY_A.x, clientY: KEY_A.y });
        expect(onNoteOn).toHaveBeenCalledTimes(1);
        const note = onNoteOn.mock.calls[0]![0];

        // Capture silently no-ops in some environments: the canvas never gets
        // pointerup, only the window does. The fallback listener must release.
        window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 7 }));
        expect(onNoteOff).toHaveBeenCalledTimes(1);
        expect(onNoteOff).toHaveBeenCalledWith(note);
    });

    it('does not double-release when both canvas and window see pointerup', () => {
        const onNoteOn = vi.fn<(midi: number, velocity: number) => void>();
        const onNoteOff = vi.fn<(midi: number) => void>();
        const { container } = render(
            <PianoModel3D
                activeNotes={new Map()}
                sustainPedal={0}
                lidPosition={0.5}
                onNoteOn={onNoteOn}
                onNoteOff={onNoteOff}
            />
        );
        const canvas = container.querySelector('canvas')!;

        fireEvent.pointerDown(canvas, { pointerId: 3, clientX: KEY_A.x, clientY: KEY_A.y });
        fireEvent.pointerUp(canvas, { pointerId: 3, clientX: KEY_A.x, clientY: KEY_A.y });
        window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 3 }));

        expect(onNoteOff).toHaveBeenCalledTimes(1);
    });

    it.each(['blur', 'lostpointercapture'] as const)('keeps the acquired release route after %s', (interruption) => {
        const onNoteOn = vi.fn<(midi: number, velocity: number) => void>();
        const onNoteOff = vi.fn<(midi: number) => void>();
        const replacementNoteOff = vi.fn<(midi: number) => void>();
        const props = {
            activeNotes: new Map(),
            sustainPedal: 0,
            lidPosition: 0.5,
            onNoteOn,
            onNoteOff,
        };
        const { container, rerender } = render(<PianoModel3D {...props} />);
        const canvas = container.querySelector('canvas')!;
        fireEvent.pointerDown(canvas, { pointerId: 4, clientX: KEY_A.x, clientY: KEY_A.y });
        fireEvent.pointerDown(canvas, { pointerId: 5, clientX: KEY_B.x, clientY: KEY_B.y });
        expect(onNoteOn.mock.calls).toHaveLength(2);
        const heldNotes = onNoteOn.mock.calls.map(([note]) => note);
        expect(new Set(heldNotes).size).toBe(2);

        rerender(<PianoModel3D {...props} onNoteOff={replacementNoteOff} />);
        if (interruption === 'blur') {
            fireEvent.blur(window);
        } else {
            fireEvent(canvas, new PointerEvent(interruption, { bubbles: true, pointerId: 4 }));
        }
        expect(onNoteOff).not.toHaveBeenCalled();
        expect(replacementNoteOff).not.toHaveBeenCalled();

        window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 4 }));
        window.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 5 }));
        expect(onNoteOff.mock.calls).toEqual(heldNotes.map((note) => [note]));
        expect(replacementNoteOff).not.toHaveBeenCalled();
    });

    it('unmounts without issuing a Note Off or leaving window release listeners', () => {
        const onNoteOn = vi.fn<(midi: number, velocity: number) => void>();
        const onNoteOff = vi.fn<(midi: number) => void>();
        const { getByLabelText, unmount } = render(
            <PianoModel3D
                activeNotes={new Map()}
                sustainPedal={0}
                lidPosition={0.5}
                onNoteOn={onNoteOn}
                onNoteOff={onNoteOff}
            />
        );
        const canvas = getByLabelText('Grand Boule interactive piano');
        fireEvent.pointerDown(canvas, { pointerId: 4, clientX: KEY_A.x, clientY: KEY_A.y });
        expect(onNoteOn).toHaveBeenCalledOnce();

        unmount();
        expect(onNoteOff).not.toHaveBeenCalled();
        fireEvent.pointerUp(window, { pointerId: 4 });
        expect(onNoteOff).not.toHaveBeenCalled();
    });

    it('announces the currently playing notes through a live region', () => {
        const activeNotes = new Map<number, number>([
            [60, 0.8],
            [64, 0.8],
        ]);
        const { container } = render(<PianoModel3D activeNotes={activeNotes} sustainPedal={0} lidPosition={0.5} />);
        const live = container.querySelector('[role="status"][aria-live="polite"]');
        expect(live).toBeTruthy();
        expect(live?.textContent).toBe('Playing C4, E4');
    });
});
