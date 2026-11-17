import { useState, type ReactNode } from 'react';

import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, it, expect, vi } from 'vitest';

import { BacteriaPanel } from '#/modules/Bacteria/presentations/views';
import { beginDragGesture, isDragGestureActive } from '#/utils/UI/activeDragGesture';

import { FloatingDevicePanel, type DevicePanelGeometry } from '../FloatingDevicePanel';

function Workspace({ children }: { children?: ReactNode }) {
    const [open, setOpen] = useState(false);
    const [geometry, setGeometry] = useState<DevicePanelGeometry | null>(null);
    return (
        <>
            <main id="main-content" tabIndex={-1}>
                Timeline
            </main>
            <button onClick={() => setOpen(true)}>Open editor</button>
            {open ? (
                <FloatingDevicePanel
                    label="Sampler"
                    labelColor="text-primary"
                    borderColor="border-primary"
                    otherSurfaceOwnsEscape={() => false}
                    geometry={geometry}
                    setGeometry={setGeometry}
                    onClose={() => setOpen(false)}
                >
                    {children}
                </FloatingDevicePanel>
            ) : null}
        </>
    );
}

function openEditor() {
    const trigger = screen.getByRole('button', { name: 'Open editor' });
    trigger.focus();
    fireEvent.click(trigger);
    return screen.getByRole('dialog', { name: 'Sampler' });
}

function getTitleWithPointerCapture() {
    const title = screen.getByRole('button', { name: 'Move Sampler panel' });
    const captured = new Set<number>();
    vi.spyOn(title, 'setPointerCapture').mockImplementation((id) => {
        captured.add(id);
    });
    vi.spyOn(title, 'releasePointerCapture').mockImplementation((id) => {
        captured.delete(id);
    });
    Object.defineProperty(title, 'hasPointerCapture', { value: (id: number) => captured.has(id) });
    return title;
}

describe('FloatingDevicePanel', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('opens above an interactive workspace and restores focus when closed', () => {
        render(
            <Workspace>
                <button>Device control</button>
            </Workspace>
        );
        const panel = openEditor();
        expect(panel).toHaveFocus();
        expect(panel).toHaveAttribute('aria-modal', 'false');
        const body = screen.getByTestId('floating-device-panel-body');
        expect(body).toContainElement(screen.getByRole('button', { name: 'Device control' }));
        expect(body).toHaveClass('overflow-auto', 'overscroll-contain');
        const timeline = screen.getByRole('main');
        timeline.focus();
        expect(timeline).toHaveFocus();
        fireEvent.keyDown(timeline, { key: 'Escape', code: 'Escape' });
        expect(panel).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Open editor' })).toHaveFocus();
    });

    it('cancels just the active title drag on the first plain Escape and closes on the next', () => {
        vi.spyOn(Element.prototype, 'clientWidth', 'get').mockReturnValue(1568);
        vi.spyOn(Element.prototype, 'clientHeight', 'get').mockReturnValue(868);
        render(<Workspace />);
        const panel = openEditor();
        const title = getTitleWithPointerCapture();
        const pointer = { pointerId: 7, button: 0 };
        fireEvent.pointerDown(title, { ...pointer, clientX: 200, clientY: 100 });
        fireEvent.keyDown(title, { key: 'Escape', code: 'Escape', shiftKey: true });
        fireEvent.keyDown(title, { key: 'Escape', code: 'Escape', repeat: true });
        fireEvent.blur(title, { bubbles: true });
        fireEvent.pointerMove(title, { ...pointer, clientX: 220, clientY: 120 });
        expect(panel).toHaveStyle({ left: '204px', top: '74px' });
        const nextOwner = vi.fn();
        window.addEventListener('keydown', nextOwner, true);
        try {
            fireEvent.keyDown(title, { key: 'Escape', code: 'Escape' });
        } finally {
            window.removeEventListener('keydown', nextOwner, true);
        }
        expect(panel).toBeInTheDocument();
        expect(nextOwner).not.toHaveBeenCalled();
        fireEvent.pointerMove(title, { ...pointer, clientX: 290, clientY: 190 });
        expect(panel).toHaveStyle({ left: '204px', top: '74px' });
        expect(isDragGestureActive()).toBe(false);
        fireEvent.keyDown(title, { key: 'Escape', code: 'Escape' });
        expect(panel).not.toBeInTheDocument();
    });

    it.each(['pointerUp', 'pointerCancel', 'lostPointerCapture', 'blur', 'unmount', 'Escape'] as const)(
        'releases only the title drag on %s',
        (finish) => {
            const { unmount } = render(<Workspace />);
            openEditor();
            const title = getTitleWithPointerCapture();
            const endForeign = beginDragGesture();
            try {
                fireEvent.pointerDown(title, { pointerId: 8, button: 0, clientX: 200, clientY: 100 });
                fireEvent.pointerCancel(title, { pointerId: 9 });
                expect(title.hasPointerCapture(8)).toBe(true);
                expect(document.documentElement).toHaveAttribute('data-drag-gesture-active', '2');
                if (finish === 'unmount') {
                    unmount();
                } else if (finish === 'blur') {
                    fireEvent.blur(window);
                } else if (finish === 'Escape') {
                    fireEvent.keyDown(title, { key: 'Escape', code: 'Escape' });
                } else {
                    if (finish === 'lostPointerCapture') {
                        title.releasePointerCapture(8);
                    }
                    fireEvent[finish](title, { pointerId: 8 });
                }
                expect(title.hasPointerCapture(8)).toBe(false);
                expect(isDragGestureActive()).toBe(true);
            } finally {
                endForeign();
            }
            expect(isDragGestureActive()).toBe(false);
        }
    );

    it('recovers usable bounds after workspace changes and retains movement and size on reopen', () => {
        let availableWidth = 1568;
        let availableHeight = 868;
        let measure: () => void = () => {
            throw new Error('Workspace observer missing');
        };
        vi.spyOn(Element.prototype, 'clientWidth', 'get').mockImplementation(() => availableWidth);
        vi.spyOn(Element.prototype, 'clientHeight', 'get').mockImplementation(() => availableHeight);
        vi.stubGlobal(
            'ResizeObserver',
            class {
                constructor(callback: () => void) {
                    measure = callback;
                }
                observe() {}
                disconnect() {}
            }
        );
        render(<Workspace />);
        const panel = openEditor();
        expect(panel).toHaveStyle({ width: '1200px', height: '760px', left: '184px', top: '54px' });
        const title = getTitleWithPointerCapture();
        fireEvent.pointerDown(title, { button: 0, pointerId: 1, clientX: 200, clientY: 100 });
        fireEvent.pointerMove(title, { pointerId: 1, clientX: 220, clientY: 120 });
        fireEvent.pointerUp(title, { pointerId: 1 });
        const width = screen.getByRole('separator', { name: 'Resize Sampler width' });
        const height = screen.getByRole('separator', { name: 'Resize Sampler height' });
        fireEvent.keyDown(width, { key: 'Home' });
        fireEvent.pointerDown(height, { button: 0, pointerId: 2, clientX: 0, clientY: 800 });
        fireEvent.pointerMove(document, { pointerId: 2, clientX: 0, clientY: 750 });
        fireEvent.pointerUp(document, { pointerId: 2 });
        expect(panel).toHaveStyle({ width: '320px', height: '710px', left: '204px', top: '74px' });
        fireEvent.keyDown(width, { key: 'ArrowRight' });
        fireEvent.keyDown(height, { key: 'ArrowUp' });
        fireEvent.click(screen.getByRole('button', { name: 'Close Sampler' }));
        const reopened = openEditor();
        expect(reopened).toHaveStyle({ width: '330px', height: '700px', left: '204px', top: '74px' });
        availableWidth = 280;
        availableHeight = 140;
        act(measure);
        expect(reopened).toHaveStyle({ width: '280px', height: '140px', left: '0px', top: '0px' });
        expect(screen.getByRole('separator', { name: 'Resize Sampler width' })).toHaveAttribute('aria-valuemax', '280');
    });
});

/**
 * Regression guard for #2311: the Bacteria faceplate spilled past its own box
 * and, painting as the later sibling of the panel column, covered the chrome's
 * Close Bacteria button — pointer clicks hit the faceplate subtree and did
 * nothing, while keyboard activation kept working.
 */
describe('FloatingDevicePanel — Bacteria faceplate containment (#2311)', () => {
    const getFaceplate = (): HTMLElement | null => document.querySelector<HTMLElement>('.bacteria-faceplate');

    const renderBacteriaPanel = (deviceId: string, onClose: () => void): void => {
        render(
            <FloatingDevicePanel
                label="Bacteria"
                labelColor="text-rose-400"
                borderColor="border-rose-500/20"
                otherSurfaceOwnsEscape={() => false}
                geometry={null}
                setGeometry={vi.fn()}
                onClose={onClose}
            >
                <BacteriaPanel deviceId={deviceId} />
            </FloatingDevicePanel>
        );
    };

    it('clicking Close Bacteria fires the close path with the faceplate clipped off the chrome', () => {
        const onClose = vi.fn();
        renderBacteriaPanel('dev-2311-click', onClose);

        fireEvent.click(screen.getByRole('button', { name: 'Close Bacteria' }));
        expect(onClose).toHaveBeenCalledTimes(1);

        // jsdom lays nothing out, so the overlap itself cannot render here and
        // the click above exercises only the handler wiring. This asserts the
        // fix's mechanism instead: the faceplate root clips its subtree. In a
        // real browser an `overflow: hidden` faceplate can neither paint nor
        // hit-test above its own box, so the Close button — an earlier sibling
        // in the panel column — stays the top hit target for pointer clicks.
        const faceplate = getFaceplate();
        expect(faceplate).not.toBeNull();
        expect(getComputedStyle(faceplate as HTMLElement).overflow).toBe('hidden');
    });

    it('Close Bacteria stays keyboard-operable', () => {
        const onClose = vi.fn();
        renderBacteriaPanel('dev-2311-keyboard', onClose);

        const closeBtn = screen.getByRole('button', { name: 'Close Bacteria' });
        closeBtn.focus();
        // The containment clips painting only; the control must remain
        // focusable for Enter activation, which the browser synthesizes into
        // the same click jsdom cannot synthesize here.
        expect(closeBtn).toBe(document.activeElement);
        fireEvent.click(closeBtn);
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('faceplate controls keep receiving their own interactions', async () => {
        const onClose = vi.fn();
        renderBacteriaPanel('dev-2311-faceplate', onClose);

        // The fix clips overflow; it must not blanket-disable pointer events on
        // the faceplate, or every control inside it would die with the fix.
        const faceplate = getFaceplate() as HTMLElement;
        expect(getComputedStyle(faceplate).pointerEvents).not.toBe('none');

        // A faceplate interaction still routes end to end: clicking the Shape
        // level chip writes the bacteria store and re-renders the level-2 hero
        // ('Zoomed strips' exists only in that hero).
        fireEvent.click(screen.getByRole('button', { name: 'Shape' }));
        expect(await screen.findByText('Zoomed strips')).toBeTruthy();
        expect(onClose).not.toHaveBeenCalled();
    });
});
