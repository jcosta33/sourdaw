import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
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
