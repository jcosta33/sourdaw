import { render, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { ADSREnvelope } from '../ADSREnvelope';

type GetContext2d = (contextId: '2d', options?: CanvasRenderingContext2DSettings) => CanvasRenderingContext2D | null;

const spyOnGetContext = (ctx: CanvasRenderingContext2D): void => {
    const proto: { getContext: GetContext2d } = HTMLCanvasElement.prototype;
    vi.spyOn(proto, 'getContext').mockReturnValue(ctx);
};

type PointerCaptureSpy = {
    capturedPointerId: number | null;
    events: string[];
};

const installPointerCaptureSpy = (element: HTMLElement): PointerCaptureSpy => {
    const state: PointerCaptureSpy = { capturedPointerId: null, events: [] };
    Object.defineProperty(element, 'setPointerCapture', {
        configurable: true,
        value: vi.fn((pointerId: number) => {
            state.capturedPointerId = pointerId;
            state.events.push(`set:${pointerId}`);
        }),
    });
    Object.defineProperty(element, 'releasePointerCapture', {
        configurable: true,
        value: vi.fn((pointerId: number) => {
            if (state.capturedPointerId === pointerId) {
                state.capturedPointerId = null;
            }
            state.events.push(`release:${pointerId}`);
        }),
    });
    return state;
};

const getCanvas = (container: HTMLElement): HTMLCanvasElement => {
    const canvas = container.querySelector('canvas');
    if (!(canvas instanceof HTMLCanvasElement)) {
        throw new TypeError('Expected an ADSREnvelope canvas');
    }
    installPointerCaptureSpy(canvas);
    return canvas;
};

// Default props: attack=0.5, decay=0.5, sustain=0.5, release=0.5, width=200, height=80.
// totalTime = attack + decay + 0.4 (sustain hold) + release = 1.9.
// pad=6, plotW=188, plotH=68 -> breakpoints (see ADSREnvelope.tsx lines 71-93):
//   attack  x = 6 + (0.5/1.9)*188 ≈ 55.47, y = topY = 8
//   decay   x ≈ 104.95,             y = sustainY = 74 - 0.5*64 = 42
//   sustain x ≈ 144.53,             y = sustainY = 42
//   release x ≈ 194.0,              y = bottomY = 74
// jsdom's getBoundingClientRect is all-zero so client coords map 1:1 to canvas coords.
const ATTACK_X = 55.47;
const ATTACK_Y = 8;
const DECAY_X = 104.95;
const DECAY_Y = 42;
const SUSTAIN_X = 144.53;
const SUSTAIN_Y = 42;
const RELEASE_X = 194;
const RELEASE_Y = 74;

const defaultProps = { attack: 0.5, decay: 0.5, sustain: 0.5, release: 0.5 };

describe('ADSREnvelope', () => {
    it('should render canvas', () => {
        const { container } = render(<ADSREnvelope {...defaultProps} />);
        expect(container.querySelector('canvas')).toBeInTheDocument();
    });

    it('paints the drag hint only when interactive and not dragging', () => {
        const ctx = document.createElement('canvas').getContext('2d')!;
        const fillTextSpy = vi.spyOn(ctx, 'fillText');
        spyOnGetContext(ctx);

        const { rerender, container } = render(<ADSREnvelope {...defaultProps} />);
        expect(fillTextSpy).not.toHaveBeenCalledWith('drag to adjust', expect.any(Number), expect.any(Number));

        rerender(<ADSREnvelope {...defaultProps} onParamChange={vi.fn()} />);
        expect(fillTextSpy).toHaveBeenCalledWith('drag to adjust', expect.any(Number), expect.any(Number));

        expect(container.querySelector('canvas')).toHaveAttribute('aria-label', 'ADSR envelope shape');
        vi.restoreAllMocks();
    });

    it('ignores a pointer press far from every breakpoint', () => {
        const onParamChange = vi.fn();
        const { container } = render(<ADSREnvelope {...defaultProps} onParamChange={onParamChange} />);
        const canvas = getCanvas(container);

        fireEvent.pointerDown(canvas, { clientX: 0, clientY: 0, pointerId: 1 });
        fireEvent.pointerMove(canvas, { clientX: 20, clientY: 20, pointerId: 1 });

        expect(onParamChange).not.toHaveBeenCalled();
    });

    it('drags the attack breakpoint horizontally and reports the mapped seconds', () => {
        const onParamChange = vi.fn();
        const { container } = render(<ADSREnvelope {...defaultProps} onParamChange={onParamChange} />);
        const canvas = getCanvas(container);

        fireEvent.pointerDown(canvas, { clientX: ATTACK_X, clientY: ATTACK_Y, pointerId: 1 });
        expect(canvas.setPointerCapture).toHaveBeenCalledWith(1);
        expect(canvas.style.cursor).toBe('grabbing');

        // mx=100 -> xRatio=(100-6)/188=0.5 -> mappedTime=0.5*1.9=0.95 -> attack=0.95
        fireEvent.pointerMove(canvas, { clientX: 100, clientY: ATTACK_Y, pointerId: 1 });
        const lastCall = onParamChange.mock.calls.at(-1);
        expect(lastCall?.[0]).toBe('attack');
        expect(lastCall?.[1]).toBeCloseTo(0.95, 2);

        fireEvent.pointerUp(canvas, { pointerId: 1 });
        expect(canvas.releasePointerCapture).toHaveBeenCalledWith(1);
        expect(canvas.style.cursor).toBe('grab');
    });

    it('clamps the attack drag to the 0.001s floor', () => {
        const onParamChange = vi.fn();
        const { container } = render(<ADSREnvelope {...defaultProps} onParamChange={onParamChange} />);
        const canvas = getCanvas(container);

        fireEvent.pointerDown(canvas, { clientX: ATTACK_X, clientY: ATTACK_Y, pointerId: 1 });
        fireEvent.pointerMove(canvas, { clientX: -50, clientY: ATTACK_Y, pointerId: 1 });

        expect(onParamChange).toHaveBeenCalledWith('attack', 0.001);
    });

    it('clamps the attack drag to the 2s ceiling', () => {
        // attack=1, decay=1, sustain=0.5, release=1 -> totalTime = 1+1+0.4+1 = 3.4,
        // long enough that dragging fully right maps past the 2s attack ceiling.
        const props = { attack: 1, decay: 1, sustain: 0.5, release: 1 };
        const onParamChange = vi.fn();
        const { container } = render(<ADSREnvelope {...props} onParamChange={onParamChange} />);
        const canvas = getCanvas(container);

        // Attack breakpoint x = 6 + (1/3.4)*188 ≈ 61.29, y = topY = 8.
        fireEvent.pointerDown(canvas, { clientX: 61.29, clientY: 8, pointerId: 1 });
        fireEvent.pointerMove(canvas, { clientX: 1000, clientY: 8, pointerId: 1 });

        expect(onParamChange).toHaveBeenCalledWith('attack', 2);
    });

    it('drags the decay breakpoint and reports decay time relative to attack', () => {
        const onParamChange = vi.fn();
        const { container } = render(<ADSREnvelope {...defaultProps} onParamChange={onParamChange} />);
        const canvas = getCanvas(container);

        fireEvent.pointerDown(canvas, { clientX: DECAY_X, clientY: DECAY_Y, pointerId: 2 });
        // mx=85.16 -> mappedTime = (85.16-6)/188 * 1.9 ≈ 0.8 -> decay = 0.8 - attack(0.5) = 0.3
        fireEvent.pointerMove(canvas, { clientX: 85.16, clientY: DECAY_Y, pointerId: 2 });

        const lastCall = onParamChange.mock.calls.at(-1);
        expect(lastCall?.[0]).toBe('decay');
        expect(lastCall?.[1]).toBeCloseTo(0.3, 1);
    });

    it('drags the release breakpoint and reports release time relative to the sustain end', () => {
        const onParamChange = vi.fn();
        const { container } = render(<ADSREnvelope {...defaultProps} onParamChange={onParamChange} />);
        const canvas = getCanvas(container);

        fireEvent.pointerDown(canvas, { clientX: RELEASE_X, clientY: RELEASE_Y, pointerId: 3 });
        // mx=164.32 -> mappedTime ≈ 1.6 -> release = 1.6 - sustainEnd(1.4) = 0.2
        fireEvent.pointerMove(canvas, { clientX: 164.32, clientY: RELEASE_Y, pointerId: 3 });

        const lastCall = onParamChange.mock.calls.at(-1);
        expect(lastCall?.[0]).toBe('release');
        expect(lastCall?.[1]).toBeCloseTo(0.2, 1);
    });

    it('lengthens release from physical pointer movement and stays stable after controlled rerender', () => {
        let release = defaultProps.release;
        const onParamChange = vi.fn((stage: string, value: number) => {
            if (stage !== 'release') {
                return;
            }
            release = value;
        });
        const { container, rerender } = render(
            <ADSREnvelope {...defaultProps} release={release} onParamChange={onParamChange} />
        );
        const canvas = getCanvas(container);

        fireEvent.pointerDown(canvas, { button: 0, clientX: RELEASE_X, clientY: RELEASE_Y, pointerId: 9 });
        fireEvent.pointerMove(canvas, { clientX: 214, clientY: RELEASE_Y, pointerId: 9 });

        const expectedRelease = 0.5 + (214 - RELEASE_X) * (1.9 / 188);
        expect(onParamChange).toHaveBeenLastCalledWith('release', expect.closeTo(expectedRelease, 12));
        expect(release).toBeGreaterThan(0.5);

        rerender(<ADSREnvelope {...defaultProps} release={release} onParamChange={onParamChange} />);
        fireEvent.pointerMove(canvas, { clientX: 214, clientY: RELEASE_Y, pointerId: 9 });

        expect(onParamChange).toHaveBeenLastCalledWith('release', expect.closeTo(expectedRelease, 12));
        fireEvent.pointerUp(canvas, { pointerId: 9 });
    });

    it('shortens release from its pointer-down value and reanchors the next gesture', () => {
        let release = defaultProps.release;
        const onParamChange = vi.fn((_stage: string, value: number) => {
            release = value;
        });
        const { container, rerender } = render(
            <ADSREnvelope {...defaultProps} release={release} onParamChange={onParamChange} />
        );
        const canvas = getCanvas(container);

        fireEvent.pointerDown(canvas, { button: 0, clientX: RELEASE_X, clientY: RELEASE_Y, pointerId: 10 });
        fireEvent.pointerMove(canvas, { clientX: 174, clientY: RELEASE_Y, pointerId: 10 });

        const shortenedRelease = 0.5 - 20 * (1.9 / 188);
        expect(onParamChange).toHaveBeenLastCalledWith('release', expect.closeTo(shortenedRelease, 12));
        rerender(<ADSREnvelope {...defaultProps} release={release} onParamChange={onParamChange} />);
        fireEvent.pointerMove(canvas, { clientX: 174, clientY: RELEASE_Y, pointerId: 10 });
        expect(onParamChange).toHaveBeenLastCalledWith('release', expect.closeTo(shortenedRelease, 12));
        fireEvent.pointerUp(canvas, { pointerId: 10 });

        fireEvent.pointerDown(canvas, { button: 0, clientX: RELEASE_X, clientY: RELEASE_Y, pointerId: 11 });
        fireEvent.pointerMove(canvas, { clientX: 184, clientY: RELEASE_Y, pointerId: 11 });
        const reanchoredRelease = shortenedRelease - 10 * ((1.4 + shortenedRelease) / 188);
        expect(onParamChange).toHaveBeenLastCalledWith('release', expect.closeTo(reanchoredRelease, 12));
        fireEvent.pointerUp(canvas, { pointerId: 11 });
    });

    it('uses physical deltas from an offset hit point and the rendered width', () => {
        let release = defaultProps.release;
        const onParamChange = vi.fn((_stage: string, value: number) => {
            release = value;
        });
        const { container, rerender } = render(
            <ADSREnvelope {...defaultProps} release={release} width={310} onParamChange={onParamChange} />
        );
        const canvas = getCanvas(container);
        Object.defineProperty(canvas, 'getBoundingClientRect', {
            configurable: true,
            value: () => ({
                x: 100,
                y: 40,
                left: 100,
                top: 40,
                right: 410,
                bottom: 120,
                width: 310,
                height: 80,
                toJSON: () => ({}),
            }),
        });

        fireEvent.pointerDown(canvas, { button: 0, clientX: 408, clientY: 114, pointerId: 12 });
        fireEvent.pointerMove(canvas, { clientX: 408, clientY: 114, pointerId: 12 });
        expect(onParamChange).toHaveBeenLastCalledWith('release', 0.5);
        rerender(<ADSREnvelope {...defaultProps} release={release} width={310} onParamChange={onParamChange} />);
        fireEvent.pointerMove(canvas, { clientX: 428, clientY: 114, pointerId: 12 });

        const expectedRelease = 0.5 + 20 * (1.9 / 298);
        expect(onParamChange).toHaveBeenLastCalledWith('release', expect.closeTo(expectedRelease, 12));
        fireEvent.pointerUp(canvas, { pointerId: 12 });
    });

    it('clamps captured release movement to its descriptor bounds', () => {
        let release = defaultProps.release;
        const onParamChange = vi.fn((_stage: string, value: number) => {
            release = value;
        });
        const { container, rerender } = render(
            <ADSREnvelope {...defaultProps} release={release} onParamChange={onParamChange} />
        );
        const canvas = getCanvas(container);

        fireEvent.pointerDown(canvas, { button: 0, clientX: RELEASE_X, clientY: RELEASE_Y, pointerId: 13 });
        fireEvent.pointerMove(canvas, { clientX: 5000, clientY: RELEASE_Y, pointerId: 13 });
        expect(onParamChange).toHaveBeenLastCalledWith('release', 5);
        fireEvent.pointerUp(canvas, { pointerId: 13 });

        rerender(<ADSREnvelope {...defaultProps} release={release} onParamChange={onParamChange} />);
        fireEvent.pointerDown(canvas, { button: 0, clientX: RELEASE_X, clientY: RELEASE_Y, pointerId: 14 });
        fireEvent.pointerMove(canvas, { clientX: -5000, clientY: RELEASE_Y, pointerId: 14 });
        expect(onParamChange).toHaveBeenLastCalledWith('release', 0.001);
        fireEvent.pointerUp(canvas, { pointerId: 14 });
    });

    it('keeps opt-in release lifecycle callbacks tied to the physical sample and final once', () => {
        let release = defaultProps.release;
        const onParamChange = vi.fn((_stage: string, value: number) => {
            release = value;
        });
        const onGestureStart = vi.fn(() => true);
        const onGestureCommit = vi.fn();
        const onGestureCancel = vi.fn();
        const props = () => (
            <ADSREnvelope
                {...defaultProps}
                release={release}
                onParamChange={onParamChange}
                onGestureStart={onGestureStart}
                onGestureCommit={onGestureCommit}
                onGestureCancel={onGestureCancel}
            />
        );
        const { container, rerender } = render(props());
        const canvas = getCanvas(container);

        fireEvent.pointerDown(canvas, { button: 0, clientX: RELEASE_X, clientY: RELEASE_Y, pointerId: 15 });
        fireEvent.pointerMove(canvas, { clientX: 214, clientY: RELEASE_Y, pointerId: 15 });
        const expectedRelease = 0.5 + 20 * (1.9 / 188);
        expect(onParamChange).toHaveBeenLastCalledWith('release', expect.closeTo(expectedRelease, 12));
        rerender(props());
        fireEvent.pointerMove(canvas, { clientX: 214, clientY: RELEASE_Y, pointerId: 15 });
        fireEvent.pointerUp(canvas, { pointerId: 15 });

        expect(onGestureStart).toHaveBeenCalledExactlyOnceWith('release');
        expect(onParamChange).toHaveBeenCalledTimes(2);
        expect(onGestureCommit).toHaveBeenCalledExactlyOnceWith('release', expect.closeTo(expectedRelease, 12));
        expect(onGestureCancel).not.toHaveBeenCalled();
    });

    it('does not orphan release lifecycle ownership when its geometry is invalid', () => {
        const onParamChange = vi.fn();
        const onGestureStart = vi.fn(() => true);
        const onGestureCommit = vi.fn();
        const onGestureCancel = vi.fn();
        const props = (width: number) => (
            <ADSREnvelope
                {...defaultProps}
                width={width}
                onParamChange={onParamChange}
                onGestureStart={onGestureStart}
                onGestureCommit={onGestureCommit}
                onGestureCancel={onGestureCancel}
            />
        );
        const { container, rerender } = render(props(200));
        const canvas = getCanvas(container);

        fireEvent.pointerDown(canvas, { button: 0, clientX: RELEASE_X, clientY: RELEASE_Y, pointerId: 16 });
        rerender(props(6));
        fireEvent.pointerMove(canvas, { clientX: RELEASE_X, clientY: RELEASE_Y, pointerId: 16 });

        expect(onGestureStart).toHaveBeenCalledExactlyOnceWith('release');
        expect(onParamChange).not.toHaveBeenCalled();
        expect(onGestureCommit).not.toHaveBeenCalled();
        expect(onGestureCancel).toHaveBeenCalledExactlyOnceWith('release');
    });

    it('drags the sustain breakpoint vertically and clamps to 0..1', () => {
        const onParamChange = vi.fn();
        const { container } = render(<ADSREnvelope {...defaultProps} onParamChange={onParamChange} />);
        const canvas = getCanvas(container);

        fireEvent.pointerDown(canvas, { clientX: SUSTAIN_X, clientY: SUSTAIN_Y, pointerId: 4 });
        // my=24.5 -> ratio = 1-(24.5-8)/66 = 0.75
        fireEvent.pointerMove(canvas, { clientX: SUSTAIN_X, clientY: 24.5, pointerId: 4 });
        expect(onParamChange).toHaveBeenCalledWith('sustain', expect.closeTo(0.75, 2));

        onParamChange.mockClear();
        fireEvent.pointerMove(canvas, { clientX: SUSTAIN_X, clientY: 200, pointerId: 4 });
        expect(onParamChange).toHaveBeenCalledWith('sustain', 0);

        onParamChange.mockClear();
        fireEvent.pointerMove(canvas, { clientX: SUSTAIN_X, clientY: -100, pointerId: 4 });
        expect(onParamChange).toHaveBeenCalledWith('sustain', 1);
    });

    it('stops reporting param changes once the pointer is released', () => {
        const onParamChange = vi.fn();
        const { container } = render(<ADSREnvelope {...defaultProps} onParamChange={onParamChange} />);
        const canvas = getCanvas(container);

        fireEvent.pointerDown(canvas, { clientX: ATTACK_X, clientY: ATTACK_Y, pointerId: 5 });
        fireEvent.pointerUp(canvas, { pointerId: 5 });

        onParamChange.mockClear();
        fireEvent.pointerMove(canvas, { clientX: 100, clientY: ATTACK_Y, pointerId: 5 });
        expect(onParamChange).not.toHaveBeenCalled();
    });

    it('does not wire pointer handlers when non-interactive', () => {
        const { container } = render(<ADSREnvelope {...defaultProps} />);
        const canvas = container.querySelector('canvas');
        if (!(canvas instanceof HTMLCanvasElement)) {
            throw new TypeError('Expected an ADSREnvelope canvas');
        }

        expect(() => {
            fireEvent.pointerDown(canvas, { clientX: ATTACK_X, clientY: ATTACK_Y, pointerId: 6 });
            fireEvent.pointerMove(canvas, { clientX: 100, clientY: ATTACK_Y, pointerId: 6 });
            fireEvent.pointerUp(canvas, { pointerId: 6 });
        }).not.toThrow();
    });
});

describe('ADSREnvelope opt-in gesture lifecycle', () => {
    function setup() {
        const onParamChange = vi.fn();
        const onGestureStart = vi.fn(() => true);
        const onGestureCommit = vi.fn();
        const onGestureCancel = vi.fn();
        const callbacks = { onParamChange, onGestureStart, onGestureCommit, onGestureCancel };
        const view = render(<ADSREnvelope {...defaultProps} {...callbacks} />);
        return { ...view, canvas: getCanvas(view.container), ...callbacks };
    }

    it.each([
        { stage: 'attack', x: ATTACK_X, y: ATTACK_Y, nextX: 100, nextY: 8, value: 0.95 },
        { stage: 'decay', x: DECAY_X, y: DECAY_Y, nextX: 85.16, nextY: 42, value: 0.3 },
        { stage: 'sustain', x: SUSTAIN_X, y: SUSTAIN_Y, nextX: 144.53, nextY: 24.5, value: 0.75 },
        { stage: 'release', x: RELEASE_X, y: RELEASE_Y, nextX: 164.32, nextY: 74, value: 0.2 },
    ])(
        'captures the hit-tested $stage and commits its last physical sample once',
        ({ stage, x, y, nextX, nextY, value }) => {
            const { canvas, onParamChange, onGestureStart, onGestureCommit, onGestureCancel } = setup();
            fireEvent.pointerDown(canvas, { button: 0, pointerId: 7, clientX: x, clientY: y });
            fireEvent.pointerDown(canvas, { button: 0, pointerId: 8, clientX: ATTACK_X, clientY: ATTACK_Y });
            fireEvent.pointerMove(canvas, { pointerId: 8, clientX: 0, clientY: 0 });
            fireEvent.pointerUp(canvas, { pointerId: 8 });
            fireEvent.pointerMove(canvas, { pointerId: 7, clientX: nextX, clientY: nextY });
            expect(onGestureStart).toHaveBeenCalledExactlyOnceWith(stage);
            expect(onParamChange).toHaveBeenCalledExactlyOnceWith(stage, expect.closeTo(value, 2));
            Object.defineProperty(canvas, 'releasePointerCapture', {
                configurable: true,
                value: vi.fn(() => fireEvent.lostPointerCapture(canvas, { pointerId: 7 })),
            });
            fireEvent.pointerUp(canvas, { pointerId: 7 });
            fireEvent.pointerUp(canvas, { pointerId: 7 });
            expect(onGestureCommit).toHaveBeenCalledExactlyOnceWith(stage, expect.closeTo(value, 2));
            expect(onParamChange).toHaveBeenCalledTimes(1);
            expect(onGestureCancel).not.toHaveBeenCalled();
        }
    );

    it.each(['pointerCancel', 'lostPointerCapture', 'windowBlur', 'hidden', 'unmount', 'nonfinite'])(
        'cancels %s exactly once without another physical sample or final',
        (finish) => {
            const { canvas, unmount, onParamChange, onGestureCommit, onGestureCancel } = setup();
            fireEvent.pointerDown(canvas, { button: 0, pointerId: 7, clientX: ATTACK_X, clientY: ATTACK_Y });
            fireEvent.pointerMove(canvas, { pointerId: 7, clientX: 100, clientY: ATTACK_Y });
            if (finish === 'pointerCancel') {
                fireEvent.pointerCancel(canvas, { pointerId: 7 });
            } else if (finish === 'lostPointerCapture') {
                fireEvent.lostPointerCapture(canvas, { pointerId: 7 });
            } else if (finish === 'windowBlur') {
                fireEvent.blur(window);
            } else if (finish === 'hidden') {
                vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
                fireEvent(document, new Event('visibilitychange'));
                vi.restoreAllMocks();
            } else if (finish === 'unmount') {
                unmount();
            } else {
                const malformed = new Event('pointermove', { bubbles: true });
                Object.defineProperties(malformed, {
                    pointerId: { value: 7 },
                    clientX: { value: Number.NaN },
                    clientY: { value: ATTACK_Y },
                });
                fireEvent(canvas, malformed);
            }
            fireEvent.pointerUp(canvas, { pointerId: 7 });
            expect(onParamChange).toHaveBeenCalledExactlyOnceWith('attack', expect.closeTo(0.95, 12));
            expect(onGestureCancel).toHaveBeenCalledExactlyOnceWith('attack');
            expect(onGestureCommit).not.toHaveBeenCalled();
        }
    );

    it('admits neither missed hits nor secondary buttons nor a refused stage', () => {
        const { canvas, onParamChange, onGestureStart, onGestureCommit } = setup();
        fireEvent.pointerDown(canvas, { button: 0, pointerId: 7, clientX: 0, clientY: 0 });
        fireEvent.pointerDown(canvas, { button: 2, pointerId: 7, clientX: ATTACK_X, clientY: ATTACK_Y });
        expect(onGestureStart).not.toHaveBeenCalled();
        onGestureStart.mockReturnValue(false);
        fireEvent.pointerDown(canvas, { button: 0, pointerId: 7, clientX: ATTACK_X, clientY: ATTACK_Y });
        fireEvent.pointerMove(canvas, { pointerId: 7, clientX: 100, clientY: ATTACK_Y });
        fireEvent.pointerUp(canvas, { pointerId: 7 });
        expect(onGestureStart).toHaveBeenCalledExactlyOnceWith('attack');
        expect(onParamChange).not.toHaveBeenCalled();
        expect(onGestureCommit).not.toHaveBeenCalled();
    });

    it('does not create a sample or final from an orphan release or a click', () => {
        const { canvas, onParamChange, onGestureCommit, onGestureCancel } = setup();
        fireEvent.pointerUp(canvas, { pointerId: 7 });
        fireEvent.pointerDown(canvas, { button: 0, pointerId: 7, clientX: ATTACK_X, clientY: ATTACK_Y });
        fireEvent.pointerUp(canvas, { pointerId: 7 });
        expect(onParamChange).not.toHaveBeenCalled();
        expect(onGestureCommit).not.toHaveBeenCalled();
        expect(onGestureCancel).toHaveBeenCalledExactlyOnceWith('attack');
    });

    it('keeps captured callbacks while using the current rendered coordinate law', () => {
        const { canvas, rerender, onParamChange, onGestureCommit } = setup();
        fireEvent.pointerDown(canvas, { button: 0, pointerId: 7, clientX: ATTACK_X, clientY: ATTACK_Y });
        const replacementChange = vi.fn();
        const replacementCommit = vi.fn();
        rerender(
            <ADSREnvelope
                {...defaultProps}
                attack={0.8}
                onParamChange={replacementChange}
                onGestureCommit={replacementCommit}
            />
        );
        fireEvent.pointerMove(canvas, { pointerId: 7, clientX: 100, clientY: 8 });
        fireEvent.pointerUp(canvas, { pointerId: 7 });
        expect(onParamChange).toHaveBeenCalledExactlyOnceWith('attack', expect.closeTo(1.1, 12));
        expect(onGestureCommit).toHaveBeenCalledExactlyOnceWith('attack', expect.closeTo(1.1, 12));
        expect(replacementChange).not.toHaveBeenCalled();
        expect(replacementCommit).not.toHaveBeenCalled();
    });

    it('keeps lifecycle-only callers read-only', () => {
        const onGestureStart = vi.fn(() => true);
        const view = render(<ADSREnvelope {...defaultProps} onGestureStart={onGestureStart} />);
        const canvas = getCanvas(view.container);
        fireEvent.pointerDown(canvas, { button: 0, pointerId: 7, clientX: ATTACK_X, clientY: ATTACK_Y });
        fireEvent.pointerMove(canvas, { pointerId: 7, clientX: 100, clientY: ATTACK_Y });
        fireEvent.pointerUp(canvas, { pointerId: 7 });
        expect(onGestureStart).not.toHaveBeenCalled();
        expect(canvas.style.cursor).toBe('');
    });
});
