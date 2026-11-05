import { useState } from 'react';

import { fireEvent, render, screen, type RenderResult } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Slider } from '../slider';

type SliderHandler = (value: number[]) => void;

describe('Slider', () => {
    it('should render a slider with one thumb by default', () => {
        render(<Slider min={0} max={100} aria-label="Level" />);
        expect(screen.getByRole('slider', { name: 'Level' })).toBeInTheDocument();
    });

    it('should call onValueChange when value updates from controlled props', () => {
        const onValueChange = vi.fn();
        const { rerender } = render(
            <Slider value={[10]} min={0} max={100} onValueChange={onValueChange} aria-label="Gain" />
        );
        rerender(<Slider value={[20]} min={0} max={100} onValueChange={onValueChange} aria-label="Gain" />);
        expect(screen.getByRole('slider', { name: 'Gain' })).toHaveAttribute('aria-valuenow', '20');
    });

    it('should reset to default when meta+pointer down on thumb with handlers', () => {
        const onValueChange = vi.fn();
        render(
            <Slider value={[50]} defaultValue={[25]} min={0} max={100} onValueChange={onValueChange} aria-label="Pan" />
        );
        const thumb = screen.getByRole('slider', { name: 'Pan' });
        fireEvent.pointerDown(thumb, { pointerId: 1, metaKey: true });
        expect(onValueChange).toHaveBeenCalledWith([25]);
    });

    it('commits a typed value when numeric editing accepts it', () => {
        const onValueChange = vi.fn();
        const onValueCommit = vi.fn();
        render(
            <Slider
                value={[100]}
                onValueChange={onValueChange}
                onValueCommit={onValueCommit}
                min={50}
                max={200}
                aria-label="UI Scale"
            />
        );

        fireEvent.doubleClick(screen.getByRole('slider', { name: 'UI Scale' }));
        fireEvent.change(screen.getByRole('textbox'), { target: { value: '150' } });
        fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });

        expect(onValueChange).toHaveBeenCalledWith([150]);
        expect(onValueCommit).toHaveBeenCalledWith([150]);
    });

    describe('gesture completion', () => {
        type Harness = {
            view: RenderResult;
            root: HTMLElement;
            thumb: HTMLElement;
            commits: number[][];
            changes: number[][];
            /** Whether the slider still holds pointer capture, as a browser tracks it. */
            capture: { held: boolean };
        };

        // A consumer that previews into its own state and writes once on commit,
        // as every product surface does.
        const LevelSlider = ({ onChange, onCommit }: { onChange: SliderHandler; onCommit: SliderHandler }) => {
            const [value, setValue] = useState([20]);
            return (
                <Slider
                    value={value}
                    onValueChange={(next) => {
                        setValue(next);
                        onChange(next);
                    }}
                    onValueCommit={onCommit}
                    min={0}
                    max={100}
                    aria-label="Level"
                />
            );
        };

        const renderLevelSlider = (): Harness => {
            const commits: number[][] = [];
            const changes: number[][] = [];
            const view = render(
                <>
                    <LevelSlider onChange={(next) => changes.push(next)} onCommit={(next) => commits.push(next)} />
                    <button type="button">Elsewhere</button>
                </>
            );
            const thumb = screen.getByRole('slider', { name: 'Level' });
            const root = thumb.closest('[data-slot="slider"]');
            if (!(root instanceof HTMLElement)) {
                throw new Error('Missing Slider root');
            }
            // jsdom has no pointer capture; hold it as a browser does, so Radix
            // commits a pointerup only while capture is still held.
            const capture = { held: false };
            Object.defineProperties(root, {
                setPointerCapture: { configurable: true, value: () => (capture.held = true) },
                releasePointerCapture: { configurable: true, value: () => (capture.held = false) },
                hasPointerCapture: { configurable: true, value: () => capture.held },
            });
            vi.spyOn(root, 'getBoundingClientRect').mockReturnValue({
                x: 0,
                y: 0,
                top: 0,
                bottom: 20,
                left: 0,
                right: 100,
                width: 100,
                height: 20,
                toJSON: () => ({}),
            });
            return { view, root, thumb, commits, changes, capture };
        };

        const drag = ({ root }: Harness): void => {
            fireEvent.pointerDown(root, { pointerId: 1, button: 0, clientX: 40, clientY: 10 });
            fireEvent.pointerMove(root, { pointerId: 1, clientX: 65, clientY: 10 });
        };

        const setVisibility = (state: DocumentVisibilityState): void => {
            Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
            fireEvent(document, new Event('visibilitychange'));
        };

        afterEach(() => {
            setVisibility('visible');
        });

        it('previews a drag without committing it', () => {
            const harness = renderLevelSlider();
            drag(harness);
            expect(harness.changes).toEqual([[40], [65]]);
            expect(harness.commits).toEqual([]);
        });

        it.each([
            [
                'pointercancel',
                ({ root, capture }: Harness) => {
                    fireEvent.pointerCancel(root, { pointerId: 1 });
                    capture.held = false;
                    fireEvent.lostPointerCapture(root, { pointerId: 1 });
                },
            ],
            [
                'lost pointer capture without a pointerup',
                ({ root, capture }: Harness) => {
                    capture.held = false;
                    fireEvent.lostPointerCapture(root, { pointerId: 1 });
                },
            ],
            ['the window losing focus', () => fireEvent.blur(window)],
            ['the document hiding', () => setVisibility('hidden')],
            [
                'focus leaving the slider',
                ({ thumb }: Harness) => {
                    fireEvent.focusOut(thumb, { relatedTarget: screen.getByRole('button', { name: 'Elsewhere' }) });
                },
            ],
        ])('commits the last previewed value once when %s ends the drag', (_route, end) => {
            const harness = renderLevelSlider();
            drag(harness);
            end(harness);
            expect(harness.commits).toEqual([[65]]);
            // A pointerup the slider still sees afterwards (capture may still be
            // held) must not commit the gesture a second time.
            fireEvent.pointerUp(harness.root, { pointerId: 1 });
            fireEvent.blur(window);
            harness.view.unmount();
            expect(harness.commits).toEqual([[65]]);
        });

        it('commits the last previewed value once when the slider unmounts mid-drag', () => {
            const harness = renderLevelSlider();
            drag(harness);
            harness.view.unmount();
            expect(harness.commits).toEqual([[65]]);
        });

        it('settles an abandoned drag through the commit of the render that previewed it', () => {
            const first: number[][] = [];
            const second: number[][] = [];
            const renderTarget = (commits: number[][]) => (
                <Slider value={[20]} onValueChange={vi.fn()} onValueCommit={(next) => commits.push(next)} />
            );
            const view = render(renderTarget(first));
            const root = screen.getByRole('slider').closest('[data-slot="slider"]');
            if (!(root instanceof HTMLElement)) {
                throw new Error('Missing Slider root');
            }
            Object.defineProperties(root, {
                setPointerCapture: { configurable: true, value: vi.fn() },
                hasPointerCapture: { configurable: true, value: () => true },
            });
            vi.spyOn(root, 'getBoundingClientRect').mockReturnValue({
                x: 0,
                y: 0,
                top: 0,
                bottom: 20,
                left: 0,
                right: 100,
                width: 100,
                height: 20,
                toJSON: () => ({}),
            });
            fireEvent.pointerDown(root, { pointerId: 1, button: 0, clientX: 40, clientY: 10 });
            view.rerender(renderTarget(second));
            fireEvent.blur(window);
            expect(first).toEqual([[40]]);
            expect(second).toEqual([]);
        });

        it('commits a normal pointer release once and adds nothing for the capture loss after it', () => {
            const harness = renderLevelSlider();
            drag(harness);
            fireEvent.pointerUp(harness.root, { pointerId: 1 });
            fireEvent.lostPointerCapture(harness.root, { pointerId: 1 });
            fireEvent.blur(window);
            harness.view.unmount();
            expect(harness.commits).toEqual([[65]]);
        });

        it('commits a keyboard step once, previewed before it commits, and adds nothing on a later blur or unmount', () => {
            const calls: [string, number[]][] = [];
            const view = render(
                <Slider
                    value={[20]}
                    onValueChange={(next) => calls.push(['change', next])}
                    onValueCommit={(next) => calls.push(['commit', next])}
                    min={0}
                    max={100}
                    aria-label="Level"
                />
            );
            const thumb = screen.getByRole('slider', { name: 'Level' });
            fireEvent.keyDown(thumb, { key: 'ArrowRight' });
            expect(calls).toEqual([
                ['change', [21]],
                ['commit', [21]],
            ]);
            fireEvent.focusOut(thumb, { relatedTarget: null });
            fireEvent.blur(window);
            setVisibility('hidden');
            view.unmount();
            expect(calls).toEqual([
                ['change', [21]],
                ['commit', [21]],
            ]);
        });

        it('commits nothing for a gesture that changed nothing', () => {
            const harness = renderLevelSlider();
            // Pressing where the thumb already sits reports no change.
            fireEvent.pointerDown(harness.root, { pointerId: 1, button: 0, clientX: 20, clientY: 10 });
            fireEvent.pointerCancel(harness.root, { pointerId: 1 });
            fireEvent.blur(window);
            harness.view.unmount();
            expect(harness.changes).toEqual([]);
            expect(harness.commits).toEqual([]);
        });

        it("keeps a caller's pointer and focus handlers", () => {
            const onPointerDown = vi.fn();
            const onPointerCancel = vi.fn();
            const onLostPointerCapture = vi.fn();
            const onBlur = vi.fn();
            const onKeyDownCapture = vi.fn();
            render(
                <Slider
                    value={[20]}
                    onValueChange={vi.fn()}
                    onValueCommit={vi.fn()}
                    onPointerDown={onPointerDown}
                    onPointerCancel={onPointerCancel}
                    onLostPointerCapture={onLostPointerCapture}
                    onBlur={onBlur}
                    onKeyDownCapture={onKeyDownCapture}
                    aria-label="Level"
                />
            );
            const thumb = screen.getByRole('slider', { name: 'Level' });
            Object.defineProperty(thumb, 'setPointerCapture', { configurable: true, value: vi.fn() });
            fireEvent.pointerDown(thumb, { pointerId: 1 });
            fireEvent.pointerCancel(thumb, { pointerId: 1 });
            fireEvent.lostPointerCapture(thumb, { pointerId: 1 });
            fireEvent.focusOut(thumb, { relatedTarget: null });
            fireEvent.keyDown(thumb, { key: 'Shift' });
            expect(onPointerDown).toHaveBeenCalledOnce();
            expect(onPointerCancel).toHaveBeenCalledOnce();
            expect(onLostPointerCapture).toHaveBeenCalledOnce();
            expect(onBlur).toHaveBeenCalledOnce();
            expect(onKeyDownCapture).toHaveBeenCalledOnce();
        });
    });
});
