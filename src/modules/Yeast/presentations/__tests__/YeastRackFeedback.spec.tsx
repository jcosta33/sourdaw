import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { YeastPreviewSurface } from '../views/YeastPreviewSurface';

import { createPreviewEvent, createPreviewSnapshot } from './yeastPreviewFixtures';

import type { YeastPreviewSnapshot } from '../../models/YeastPreviewSnapshot';

const previewMocks = vi.hoisted(() => ({
    onSnapshot: undefined as undefined | ((snapshot: YeastPreviewSnapshot, sampledAt: number) => void),
    frames: [] as FrameRequestCallback[],
}));

vi.mock('../../useCases/subscribeYeastPreview', () => ({
    subscribeYeastPreview: vi.fn(
        (input: { onSnapshot: (snapshot: YeastPreviewSnapshot, sampledAt: number) => void }) => {
            previewMocks.onSnapshot = input.onSnapshot;
            return vi.fn();
        }
    ),
}));

vi.mock('../createYeastPreviewCanvasRenderer', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../createYeastPreviewCanvasRenderer')>();
    return {
        ...actual,
        createYeastPreviewCanvasRenderer: () => ({
            backend: 'canvas2d' as const,
            render: vi.fn(),
            resize: vi.fn(),
            dispose: vi.fn(),
        }),
    };
});

describe('Yeast rack preview feedback', () => {
    beforeEach(() => {
        previewMocks.onSnapshot = undefined;
        previewMocks.frames.length = 0;
        vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
            previewMocks.frames.push(callback);
            return previewMocks.frames.length;
        });
        vi.stubGlobal('cancelAnimationFrame', vi.fn());
    });

    it('shows typed unavailability and runtime errors', () => {
        const { rerender } = render(
            <YeastPreviewSurface
                scope={null}
                unavailableReason={{ code: 'no-track', message: 'Select a MIDI track.' }}
                processors={[]}
            />
        );

        expect(screen.getByText('Unavailable')).toBeInTheDocument();
        expect(screen.getByText('Select a MIDI track.')).toHaveAttribute('data-reason-code', 'no-track');

        rerender(
            <YeastPreviewSurface
                scope={{ rackId: 'rack-1', routeId: 'track-1', trackId: 'track-1' }}
                processors={[]}
                runtimeStatus="unavailable"
                runtimeError="Worker failed to start"
            />
        );
        expect(screen.getByText('Error')).toBeInTheDocument();
        expect(screen.getByText('Worker failed to start')).toHaveAttribute('data-reason-code', 'runtime-error');
    });

    it('reports active preview latency and processor bypass activity', () => {
        render(
            <YeastPreviewSurface
                scope={{ rackId: 'rack-1', routeId: 'track-1', trackId: 'track-1' }}
                processors={[
                    { id: 'arp-1', bypassed: false },
                    { id: 'human-1', bypassed: true },
                ]}
                runtimeStatus="ready"
            />
        );

        act(() => {
            previewMocks.onSnapshot?.(
                createPreviewSnapshot([createPreviewEvent()], {
                    provenance: [
                        { processorId: 'arp-1', bypassed: false, failed: false, eventCount: 1 },
                        { processorId: 'human-1', bypassed: true, failed: false, eventCount: 0 },
                    ],
                }),
                performance.now()
            );
            previewMocks.frames.shift()?.(performance.now());
        });

        expect(screen.getByText('Active')).toBeInTheDocument();
        expect(screen.getByText(/ms/, { selector: 'dd' })).toBeInTheDocument();
        expect(screen.getByText('1 active · 0 enabled · 1 bypassed · 0 failed')).toBeInTheDocument();
    });

    it('reports enabled and failed processors from snapshot provenance without claiming activity', () => {
        render(
            <YeastPreviewSurface
                scope={{ rackId: 'rack-1', routeId: 'track-1', trackId: 'track-1' }}
                processors={[
                    { id: 'arp-1', bypassed: false },
                    { id: 'human-1', bypassed: false },
                ]}
                runtimeStatus="ready"
            />
        );

        act(() => {
            previewMocks.onSnapshot?.(
                createPreviewSnapshot([], {
                    provenance: [
                        { processorId: 'arp-1', bypassed: false, failed: false, eventCount: 0 },
                        { processorId: 'human-1', bypassed: false, failed: true, eventCount: 0 },
                    ],
                }),
                performance.now()
            );
            previewMocks.frames.shift()?.(performance.now());
        });

        expect(screen.getByText('Error')).toBeInTheDocument();
        expect(screen.getByText('A Yeast processor failed while generating preview events.')).toHaveAttribute(
            'data-reason-code',
            'processor-failed'
        );
        expect(screen.getByText('0 active · 1 enabled · 0 bypassed · 1 failed')).toBeInTheDocument();
    });

    it('distinguishes available, silent, and fully bypassed preview states', () => {
        const scope = { rackId: 'rack-1', routeId: 'track-1', trackId: 'track-1' };
        const { rerender } = render(<YeastPreviewSurface scope={scope} processors={[]} runtimeStatus="ready" />);
        expect(screen.getByText('Available')).toBeInTheDocument();

        act(() => {
            previewMocks.onSnapshot?.(createPreviewSnapshot([]), performance.now());
            previewMocks.frames.shift()?.(performance.now());
        });
        expect(screen.getByText('Silent')).toBeInTheDocument();

        rerender(
            <YeastPreviewSurface scope={scope} processors={[{ id: 'human-1', bypassed: true }]} runtimeStatus="ready" />
        );
        act(() => {
            previewMocks.onSnapshot?.(
                createPreviewSnapshot([createPreviewEvent({ bypassed: true, processorId: 'human-1' })], {
                    provenance: [{ processorId: 'human-1', bypassed: true, failed: false, eventCount: 1 }],
                }),
                performance.now()
            );
            previewMocks.frames.shift()?.(performance.now());
        });

        expect(screen.getByText('Bypassed')).toBeInTheDocument();
        expect(screen.getByText('0 active · 0 enabled · 1 bypassed · 0 failed')).toBeInTheDocument();
    });

    it("reports the rack sounding pitches through onSoundingNotesChange — KeyboardSplit's note-activity source", () => {
        const onSoundingNotesChange = vi.fn();
        render(
            <YeastPreviewSurface
                scope={{ rackId: 'rack-1', routeId: 'track-1', trackId: 'track-1' }}
                processors={[{ id: 'arp-1', bypassed: false }]}
                runtimeStatus="ready"
                onSoundingNotesChange={onSoundingNotesChange}
            />
        );

        act(() => {
            // Playhead defaults to beat 0; this event's window [-0.5, 0.5) contains it.
            previewMocks.onSnapshot?.(
                createPreviewSnapshot([
                    createPreviewEvent({ eventId: 1, beatTime: -0.5, durationBeats: 1, pitch: 67, realized: true }),
                ]),
                performance.now()
            );
            previewMocks.frames.shift()?.(performance.now());
        });

        expect(onSoundingNotesChange).toHaveBeenLastCalledWith([67]);
    });
});
