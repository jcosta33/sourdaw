import { render } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { WaveformDisplay } from '../WaveformDisplay';

describe('WaveformDisplay', () => {
    it('should render', () => {
        const { container } = render(
            <WaveformDisplay
                instanceId="inst1"
                peaks={[0, 1, 0, -1]}
                totalFrames={100}
                height={48}
                onPositionSubscribe={() => () => {}}
            />
        );
        expect(container.querySelector('canvas')).toBeTruthy();
    });

    it('subscribes and unsubscribes to position updates', () => {
        const unsubscribe = vi.fn();
        const subscribe = vi.fn(() => unsubscribe);
        const { unmount } = render(
            <WaveformDisplay
                instanceId="inst1"
                peaks={[0, 1, 0, -1]}
                totalFrames={100}
                onPositionSubscribe={subscribe}
            />
        );
        expect(subscribe).toHaveBeenCalledWith('inst1', expect.any(Function));
        unmount();
        expect(unsubscribe).toHaveBeenCalled();
    });
});

describe('WaveformDisplay — canvas attributes', () => {
    it('applies the height prop to the canvas style', () => {
        const { container } = render(
            <WaveformDisplay
                instanceId="inst1"
                peaks={[0, 1]}
                totalFrames={100}
                height={80}
                onPositionSubscribe={() => () => {}}
            />
        );
        const canvas = container.querySelector('canvas');
        expect(canvas?.getAttribute('style')).toContain('height: 80px');
    });

    it('uses default height=120 when not provided', () => {
        const { container } = render(
            <WaveformDisplay instanceId="inst1" peaks={[0, 1]} totalFrames={100} onPositionSubscribe={() => () => {}} />
        );
        const canvas = container.querySelector('canvas');
        expect(canvas?.getAttribute('style')).toContain('height: 120px');
    });

    it('applies custom className to the canvas', () => {
        const { container } = render(
            <WaveformDisplay
                instanceId="inst1"
                peaks={[0, 1]}
                totalFrames={100}
                className="my-custom-class"
                onPositionSubscribe={() => () => {}}
            />
        );
        const canvas = container.querySelector('canvas');
        expect(canvas?.getAttribute('class')).toContain('my-custom-class');
    });

    it('renders a cursor div that starts hidden', () => {
        const { container } = render(
            <WaveformDisplay instanceId="inst1" peaks={[0, 1]} totalFrames={100} onPositionSubscribe={() => () => {}} />
        );
        const cursor = container.querySelector('[style*="display: none"], [style*="display:none"]');
        expect(cursor).toBeTruthy();
    });
});

describe('WaveformDisplay — position callback', () => {
    it('updates cursor position via the subscription callback', () => {
        let positionCallback: ((pos: number) => void) | undefined;
        const subscribe = vi.fn((_id: string, cb: (pos: number) => void) => {
            positionCallback = cb;
            return () => {};
        });
        const { container } = render(
            <WaveformDisplay instanceId="inst1" peaks={[0, 1]} totalFrames={100} onPositionSubscribe={subscribe} />
        );
        const cursor = container.querySelector('[class*="pointer-events-none"]') as HTMLElement;
        expect(cursor).toBeTruthy();

        // Simulate position update at frame 50/100 = 0.5
        if (positionCallback) {
            positionCallback(50);
        }
        // Cursor should now be visible
        expect(cursor.style.display).toBe('block');
        // Cursor left position should be set (0px in jsdom since canvas width is 0)
        expect(cursor.style.left).toContain('px');
    });

    it('hides cursor when playback frame is 0', () => {
        let positionCallback: ((pos: number) => void) | undefined;
        const subscribe = vi.fn((_id: string, cb: (pos: number) => void) => {
            positionCallback = cb;
            return () => {};
        });
        const { container } = render(
            <WaveformDisplay instanceId="inst1" peaks={[0, 1]} totalFrames={100} onPositionSubscribe={subscribe} />
        );
        const cursor = container.querySelector('[class*="pointer-events-none"]') as HTMLElement;

        // First show, then hide
        if (positionCallback) {
            positionCallback(50);
            positionCallback(0);
        }
        expect(cursor.style.display).toBe('none');
    });
});
