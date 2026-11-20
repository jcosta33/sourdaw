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
        vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockReturnValue(
            new DOMRect(0, 0, CANVAS_W, CANVAS_H)
        );
    });

    afterEach(() => vi.restoreAllMocks());

    it('releases each acquired voice once through canvas and window endings', () => {
        const releaseA = vi.fn();
        const releaseB = vi.fn();
        const start = vi.fn().mockReturnValueOnce(releaseA).mockReturnValueOnce(releaseB);
        const hold = vi.fn();
        const { getByLabelText } = render(
            <PianoModel3D
                activeNotes={new Map()}
                sustainPedal={0}
                lidPosition={0.5}
                onPreviewNote={start}
                onPreviewHoldChange={hold}
            />
        );
        const canvas = getByLabelText('Grand Boule interactive piano');
        fireEvent.pointerDown(canvas, { pointerId: 1, clientX: KEY_A.x, clientY: KEY_A.y });
        fireEvent.pointerDown(canvas, { pointerId: 2, clientX: KEY_B.x, clientY: KEY_B.y });
        expect(start).toHaveBeenCalledTimes(2);
        expect(start.mock.calls[0]?.[0]).not.toBe(start.mock.calls[1]?.[0]);
        fireEvent.pointerUp(canvas, { pointerId: 1 });
        fireEvent.pointerUp(window, { pointerId: 1 });
        expect(releaseA).toHaveBeenCalledOnce();
        expect(releaseB).not.toHaveBeenCalled();
        expect(hold.mock.calls).toEqual([[true]]);
        fireEvent.pointerCancel(window, { pointerId: 2 });
        expect(releaseB).toHaveBeenCalledOnce();
        expect(hold.mock.calls).toEqual([[true], [false]]);
    });

    it.each(['blur', 'lostpointercapture'] as const)('settles the acquired voice on %s', (event) => {
        const release = vi.fn();
        const replacement = vi.fn();
        const start = vi.fn(() => release);
        const props = { activeNotes: new Map(), sustainPedal: 0, lidPosition: 0.5, onPreviewNote: start };
        const { getByLabelText, rerender } = render(<PianoModel3D {...props} />);
        const canvas = getByLabelText('Grand Boule interactive piano');
        fireEvent.pointerDown(canvas, { pointerId: 4, clientX: KEY_A.x, clientY: KEY_A.y });
        rerender(<PianoModel3D {...props} onPreviewNote={() => replacement} />);
        if (event === 'blur') {
            fireEvent.blur(window);
        } else {
            fireEvent(canvas, new PointerEvent(event, { bubbles: true, pointerId: 4 }));
        }
        expect(release).toHaveBeenCalledOnce();
        fireEvent.pointerUp(window, { pointerId: 4 });
        expect(release).toHaveBeenCalledOnce();
        expect(replacement).not.toHaveBeenCalled();
    });

    it('settles the old strike before a pointer ID is reused', () => {
        const first = vi.fn();
        const second = vi.fn();
        const start = vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second);
        const { getByLabelText } = render(
            <PianoModel3D activeNotes={new Map()} sustainPedal={0} lidPosition={0.5} onPreviewNote={start} />
        );
        const canvas = getByLabelText('Grand Boule interactive piano');
        fireEvent.pointerDown(canvas, { pointerId: 4, clientX: KEY_A.x, clientY: KEY_A.y });
        fireEvent.blur(window);
        fireEvent.pointerDown(canvas, { pointerId: 4, clientX: KEY_B.x, clientY: KEY_B.y });
        expect(first).toHaveBeenCalledOnce();
        expect(second).not.toHaveBeenCalled();
        fireEvent.pointerUp(canvas, { pointerId: 4 });
        expect(second).toHaveBeenCalledOnce();
    });

    it.each(['hide', 'unmount'] as const)('settles the acquired voice on %s', (ending) => {
        const release = vi.fn();
        const props = { activeNotes: new Map(), sustainPedal: 0, lidPosition: 0.5, onPreviewNote: () => release };
        const { getByLabelText, rerender, unmount } = render(<PianoModel3D {...props} />);
        fireEvent.pointerDown(getByLabelText('Grand Boule interactive piano'), {
            pointerId: 4,
            clientX: KEY_A.x,
            clientY: KEY_A.y,
        });
        if (ending === 'hide') {
            rerender(<PianoModel3D {...props} visible={false} />);
        } else {
            unmount();
        }
        expect(release).toHaveBeenCalledOnce();
        fireEvent.pointerUp(window, { pointerId: 4 });
        expect(release).toHaveBeenCalledOnce();
    });

    it('announces the currently playing notes through a live region', () => {
        const activeNotes = new Map<number, number>([
            [60, 0.8],
            [64, 0.8],
        ]);
        const { getByRole } = render(<PianoModel3D activeNotes={activeNotes} sustainPedal={0} lidPosition={0.5} />);
        expect(getByRole('status')).toHaveTextContent('Playing C4, E4');
    });
});
