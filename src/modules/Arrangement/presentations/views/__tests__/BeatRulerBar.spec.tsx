import { render, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { playheadPositionRef } from '#/modules/Transport/stores';
import { disableLooping, seekPlayhead, setLoopRegion } from '#/modules/Transport/useCases';
import { animationScheduler } from '#/utils/DOM/AnimationScheduler';

import { cancelActiveTimelineGesture } from '../../../useCases/timelineInteractions/cancelActiveTimelineGesture';
import { BeatRulerBar } from '../BeatRulerBar';

// Controllable store snapshots so individual tests can seed transport/view state.
const snapshots = vi.hoisted(() => ({
    view: { scrollX: 0, scrollY: 0, pixelsPerBeat: 12, autoScrollEnabled: true },
    transport: {
        isPlaying: false,
        isLooping: false,
        loopStart: 0,
        loopEnd: 0,
        timeSignatureNumerator: 4,
    },
}));

// Mock external dependencies
vi.mock('#/infra/store/useStore', () => ({
    useStore: vi.fn((_store: unknown, _defaultValue: unknown) => {
        // Distinguish transport vs view by the transport-shaped keys.
        const probe = _store as { value?: unknown };
        const snap = probe.value;
        return snap ?? null;
    }),
}));

vi.mock('../../../stores/timelineViewStore', () => ({
    timelineViewStore: {
        get value() {
            return snapshots.view;
        },
    },
}));

vi.mock('#/modules/Transport/stores', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Transport/stores')>()),
    transportStore: {
        get value() {
            return snapshots.transport;
        },
    },
    playheadPositionRef: { current: 0 },
}));

// Capture the rAF loop registered while playing so we can drive it directly.
const loopCallbacks = vi.hoisted(() => new Map<string, () => void>());

vi.mock('#/utils/DOM/AnimationScheduler', () => ({
    animationScheduler: {
        register: vi.fn((id: string, cb: () => void) => {
            loopCallbacks.set(id, cb);
        }),
        unregister: vi.fn((id: string) => {
            loopCallbacks.delete(id);
        }),
    },
}));

vi.mock('#/modules/Transport/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Transport/useCases')>()),
    seekPlayhead: vi.fn(),
    setLoopRegion: vi.fn(),
    disableLooping: vi.fn(),
}));

vi.mock('../TimelineChromeSurface', () => ({
    TimelineChromeSurface: ({ children, ...props }: import('react').ComponentProps<'div'>) => (
        <div {...props}>{children}</div>
    ),
}));

describe('BeatRulerBar', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        snapshots.view = { scrollX: 0, scrollY: 0, pixelsPerBeat: 12, autoScrollEnabled: true };
        snapshots.transport = {
            isPlaying: false,
            isLooping: false,
            loopStart: 0,
            loopEnd: 0,
            timeSignatureNumerator: 4,
        };
    });

    it('should render without crashing', () => {
        const { container } = render(<BeatRulerBar />);
        expect(container.firstChild).toBeTruthy();
    });

    it('should render canvas element', () => {
        const { container } = render(<BeatRulerBar />);
        const canvas = container.querySelector('canvas');
        expect(canvas).toBeInTheDocument();
    });

    it('should call seekPlayhead on mouse down', () => {
        const { container } = render(<BeatRulerBar />);
        const surface = container.firstChild as HTMLElement;
        surface.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1000, height: 18 }) as DOMRect;
        fireEvent.mouseDown(surface, { button: 0, clientX: 100 });
        expect(seekPlayhead).toHaveBeenCalled();
    });

    it('should handle double click to disable looping', () => {
        const { container } = render(<BeatRulerBar />);
        const surface = container.firstChild as HTMLElement;
        fireEvent.doubleClick(surface);
        expect(disableLooping).toHaveBeenCalled();
    });

    it('scrubs the playhead during a normal drag (no loop region set)', () => {
        const { container } = render(<BeatRulerBar />);
        const surface = container.firstChild as HTMLElement;
        surface.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1000, height: 18 }) as DOMRect;
        fireEvent.mouseDown(surface, { button: 0, clientX: 100 });
        fireEvent.mouseMove(surface, { clientX: 200, buttons: 1 });
        // Scrub seeks to the cursor beat (200px / 12ppb ≈ 16.67 → max(0, 16.67)).
        expect(seekPlayhead).toHaveBeenLastCalledWith(expect.any(Number));
        // mouseUp ends the scrub without committing a loop region.
        fireEvent.mouseUp(surface);
        expect(setLoopRegion).not.toHaveBeenCalled();
    });

    it('establishes and commits a loop region on shift+drag', () => {
        const { container } = render(<BeatRulerBar />);
        const surface = container.firstChild as HTMLElement;
        surface.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1000, height: 18 }) as DOMRect;
        // Shift+drag from beat ~8.3 (100px) to beat ~25 (300px) → >= 0.25 beats.
        fireEvent.mouseDown(surface, { button: 0, clientX: 100, shiftKey: true });
        fireEvent.mouseMove(surface, { clientX: 300, buttons: 1 });
        fireEvent.mouseUp(surface);
        expect(setLoopRegion).toHaveBeenCalledWith(expect.any(Number), expect.any(Number));
        const [, endBeat] = vi.mocked(setLoopRegion).mock.calls[0]!;
        expect(endBeat).toBeGreaterThan(0);
    });

    it('does not establish a loop region for a sub-threshold shift+drag', () => {
        const { container } = render(<BeatRulerBar />);
        const surface = container.firstChild as HTMLElement;
        surface.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1000, height: 18 }) as DOMRect;
        // Shift+drag only 1px → below the 0.25-beat threshold; no loop committed.
        fireEvent.mouseDown(surface, { button: 0, clientX: 100, shiftKey: true });
        fireEvent.mouseMove(surface, { clientX: 101, buttons: 1 });
        fireEvent.mouseUp(surface);
        expect(setLoopRegion).not.toHaveBeenCalled();
    });

    it('ignores mouse move with no button held and no active drag', () => {
        const { container } = render(<BeatRulerBar />);
        const surface = container.firstChild as HTMLElement;
        surface.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1000, height: 18 }) as DOMRect;
        // buttons !== 1 → early-return path (clears any stale drag refs).
        vi.mocked(seekPlayhead).mockClear();
        fireEvent.mouseMove(surface, { clientX: 150, buttons: 0 });
        expect(seekPlayhead).not.toHaveBeenCalled();
    });

    it('ignores a non-primary-button mouse down', () => {
        const { container } = render(<BeatRulerBar />);
        const surface = container.firstChild as HTMLElement;
        fireEvent.mouseDown(surface, { button: 2, clientX: 100 });
        expect(seekPlayhead).not.toHaveBeenCalled();
    });

    it('does not scrub when a mouse-move arrives with buttons held but no scrub/loop drag started', () => {
        const { container } = render(<BeatRulerBar />);
        const surface = container.firstChild as HTMLElement;
        surface.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1000, height: 18 }) as DOMRect;
        vi.mocked(seekPlayhead).mockClear();
        // buttons=1 but neither scrub nor loop drag is active → no-op.
        fireEvent.mouseMove(surface, { clientX: 150, buttons: 1 });
        expect(seekPlayhead).not.toHaveBeenCalled();
    });

    it('Escape cancels a shift+drag loop-region preview without committing it', () => {
        const { container } = render(<BeatRulerBar />);
        const surface = container.firstChild as HTMLElement;
        surface.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1000, height: 18 }) as DOMRect;
        fireEvent.mouseDown(surface, { button: 0, clientX: 100, shiftKey: true });
        fireEvent.mouseMove(surface, { clientX: 300, buttons: 1 });

        // The loop drag is registered as an active timeline gesture; Escape
        // (via the shared canceler) discards the preview.
        expect(cancelActiveTimelineGesture()).toBe(true);

        // A later mouse-up commits nothing, and the pre-existing loop state is
        // untouched — the drag only ever previewed.
        fireEvent.mouseUp(surface, { clientX: 300 });
        expect(setLoopRegion).not.toHaveBeenCalled();
        expect(snapshots.transport.isLooping).toBe(false);
    });

    it('window blur cancels a shift+drag loop-region preview without committing it', () => {
        const { container } = render(<BeatRulerBar />);
        const surface = container.firstChild as HTMLElement;
        surface.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1000, height: 18 }) as DOMRect;
        fireEvent.mouseDown(surface, { button: 0, clientX: 100, shiftKey: true });
        fireEvent.mouseMove(surface, { clientX: 300, buttons: 1 });

        act(() => {
            window.dispatchEvent(new Event('blur'));
        });

        fireEvent.mouseUp(surface, { clientX: 300 });
        expect(setLoopRegion).not.toHaveBeenCalled();
    });

    it('registers and drives a rAF redraw loop while playing', () => {
        snapshots.transport.isPlaying = true;
        const { container, unmount } = render(<BeatRulerBar />);
        // While playing, BeatRulerBar registers a redraw loop keyed by a random id.
        expect(animationScheduler.register).toHaveBeenCalled();
        const firstCall = vi.mocked(animationScheduler.register).mock.calls[0];
        const loopId = firstCall?.[0] as string;
        const loop = loopCallbacks.get(loopId);
        expect(loop).toBeTruthy();

        // Drive the loop with an advanced playhead position — this exercises the
        // canvasRef.current redraw guard inside the playing branch.
        const canvas = container.querySelector('canvas')!;
        const ctx = canvas.getContext('2d')!;
        const fillSpy = vi.spyOn(ctx, 'fillRect');
        playheadPositionRef.current = 3;
        loop!();
        expect(fillSpy).toHaveBeenCalled();

        unmount();
        expect(animationScheduler.unregister).toHaveBeenCalled();
    });
});
