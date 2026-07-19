import { render, screen, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { type YeastState } from '../../../stores/yeastStore';
import { YeastPanel } from '../YeastPanel';

const storeMock = vi.hoisted((): { yeastState: YeastState | null } => ({
    yeastState: null,
}));
const previewCapture = vi.hoisted(() => vi.fn());
const previewRead = vi.hoisted(() => vi.fn());

vi.mock('#/infra/store/useStore', () => ({
    useStore: vi.fn((_store: unknown, defaultValue: YeastState): YeastState => storeMock.yeastState ?? defaultValue),
}));

vi.mock('../../../useCases/yeastSchedulingBridge/setYeastPreviewCaptureEnabled', () => ({
    setYeastPreviewCaptureEnabled: previewCapture,
}));

vi.mock('../../../useCases/yeastSchedulingBridge/readYeastPreviewSnapshot', () => ({
    readYeastPreviewSnapshot: previewRead,
}));

describe('YeastPanel', () => {
    beforeEach(() => {
        storeMock.yeastState = null;
        vi.clearAllMocks();
        previewRead.mockReturnValue({
            rackId: 'yeast-runtime',
            routeId: 'track-a',
            trackId: 'track-a',
            projectionVersion: 1,
            reset: false,
            capacity: 512,
            events: [],
            provenance: [],
            droppedEvents: 0,
        });
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('should render the default rack when the store has no value', () => {
        render(<YeastPanel />);

        expect(screen.getByText('Note flow')).toBeInTheDocument();
        expect(screen.getByRole('status')).toHaveTextContent('Select a MIDI track');
        expect(screen.getByText(/No processors yet/)).toBeInTheDocument();
    });

    it('should expose the default panel controls', () => {
        render(<YeastPanel />);

        expect(screen.getByRole('button', { name: 'Arp Off' })).toHaveAttribute('aria-pressed', 'false');
        expect(screen.getByRole('button', { name: 'Latch' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: '+ Arpeggiator' })).toBeInTheDocument();
        expect(screen.getByText('Mode')).toBeInTheDocument();
        expect(screen.getByText('Rate')).toBeInTheDocument();
    });

    it('should render stored processor rack text', () => {
        storeMock.yeastState = {
            processors: [
                {
                    id: 'arp-1',
                    type: 'arpeggiator',
                    name: 'Lead arp lane',
                    bypassed: false,
                },
                {
                    id: 'chord-1',
                    type: 'chord',
                    name: 'Harmony latch lane',
                    bypassed: true,
                },
            ],
            uiLevel: 3,
        };

        render(<YeastPanel />);

        expect(screen.getByText('Rack build')).toBeInTheDocument();
        const rack_read = screen.getByText('Rack read').closest('section');
        if (!rack_read) {
            throw new Error('Rack read section not found');
        }

        const rack_read_scope = within(rack_read);
        expect(rack_read_scope.getByText('Lead arp lane')).toBeInTheDocument();
        expect(rack_read_scope.getByText('Harmony latch lane')).toBeInTheDocument();
        expect(rack_read_scope.getByText('arpeggiator')).toBeInTheDocument();
        expect(rack_read_scope.getByText('chord')).toBeInTheDocument();
        expect(rack_read_scope.getByText('Bypass')).toBeInTheDocument();
        expect(rack_read_scope.getByText('Live')).toBeInTheDocument();
    });

    it('owns a route-scoped preview lifecycle and paints at no more than 30 Hz', () => {
        const frames: FrameRequestCallback[] = [];
        vi.stubGlobal(
            'requestAnimationFrame',
            vi.fn((callback: FrameRequestCallback) => {
                frames.push(callback);
                return frames.length;
            })
        );
        vi.stubGlobal('cancelAnimationFrame', vi.fn());
        vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
            () =>
                ({
                    clearRect: vi.fn(),
                    fillRect: vi.fn(),
                    fillStyle: '',
                    globalAlpha: 1,
                }) as never
        );

        const { unmount } = render(<YeastPanel trackId="track-a" />);

        expect(screen.getByRole('img', { name: 'Upcoming Yeast MIDI notes for track-a' })).toBeInTheDocument();
        expect(previewCapture).toHaveBeenCalledWith({ trackId: 'track-a', enabled: true });
        frames.shift()?.(0);
        frames.shift()?.(16);
        frames.shift()?.(34);
        expect(previewRead).toHaveBeenCalledTimes(2);
        expect(previewRead).toHaveBeenCalledWith({ trackId: 'track-a' });

        unmount();
        expect(previewCapture).toHaveBeenLastCalledWith({ trackId: 'track-a', enabled: false });
    });

    it('shows an accessible degraded preview when Canvas is unavailable', async () => {
        vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);

        render(<YeastPanel trackId="track-a" />);

        await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Preview unavailable'));
        expect(previewCapture).not.toHaveBeenCalledWith({ trackId: 'track-a', enabled: true });
    });

    it('maps scheduled time, duration, pitch, velocity, and probability onto Canvas geometry', () => {
        const frames: FrameRequestCallback[] = [];
        const fillRect = vi.fn();
        const fillStyles: string[] = [];
        const alphas: number[] = [];
        const context = {
            clearRect: vi.fn(),
            fillRect,
            get fillStyle() {
                return fillStyles.at(-1) ?? '';
            },
            set fillStyle(value: string) {
                fillStyles.push(value);
            },
            get globalAlpha() {
                return alphas.at(-1) ?? 1;
            },
            set globalAlpha(value: number) {
                alphas.push(value);
            },
        };
        vi.stubGlobal(
            'requestAnimationFrame',
            vi.fn((callback: FrameRequestCallback) => {
                frames.push(callback);
                return frames.length;
            })
        );
        vi.stubGlobal('cancelAnimationFrame', vi.fn());
        vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => context as never);
        previewRead.mockReturnValue({
            rackId: 'yeast-runtime',
            routeId: 'track-a',
            trackId: 'track-a',
            projectionVersion: 1,
            reset: true,
            capacity: 512,
            events: [
                {
                    eventId: 1,
                    rackId: 'yeast-runtime',
                    routeId: 'track-a',
                    trackId: 'track-a',
                    projectionVersion: 1,
                    phase: 'closed',
                    beatTime: 0,
                    durationBeats: 0.25,
                    pitch: 60,
                    velocity: 32,
                    probability: 0.25,
                    realized: true,
                },
                {
                    eventId: 2,
                    rackId: 'yeast-runtime',
                    routeId: 'track-a',
                    trackId: 'track-a',
                    projectionVersion: 1,
                    phase: 'closed',
                    beatTime: 1,
                    durationBeats: 0.5,
                    pitch: 72,
                    velocity: 127,
                    probability: 1,
                    realized: true,
                },
            ],
            provenance: [],
            droppedEvents: 0,
        });

        render(<YeastPanel trackId="track-a" />);
        frames.shift()?.(0);

        const first = fillRect.mock.calls[0] as [number, number, number, number];
        const second = fillRect.mock.calls[1] as [number, number, number, number];
        expect(first[0]).toBeLessThan(second[0]);
        expect(first[1]).toBeGreaterThan(second[1]);
        expect(first[2]).toBeLessThan(second[2]);
        expect(fillStyles[0]).not.toBe(fillStyles[1]);
        expect(alphas.slice(0, 2)).toEqual([0.25, 1]);
    });
});
