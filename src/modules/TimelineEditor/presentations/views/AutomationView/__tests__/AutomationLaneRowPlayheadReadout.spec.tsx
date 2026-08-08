/**
 * The lane-header value readout must follow the playhead the user hears.
 *
 * `transportStore.playheadPosition` is written only on discrete events
 * (start, seek, pause) — see `Transport/stores/playheadPositionRef.ts`. The
 * ~100 Hz channel is `playheadPositionRef`. A readout driven by the store
 * therefore freezes at the beat playback started from.
 *
 * These specs render the real `AutomationLaneHeader` and the real
 * `formatParameterValue`, and assert the rendered readout string.
 */
import { render, screen, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { playheadPositionRef } from '#/modules/Transport/stores';

import { type AutomationLane } from '../../../../models/AutomationViewTypes';
import { AutomationLaneRow } from '../AutomationLaneRow';

const { mockWorkspaceStoreRef, mockWorkspaceState, mockTransportState } = vi.hoisted(() => ({
    mockWorkspaceStoreRef: {},
    mockWorkspaceState: { activeTool: 'pointer', snapValue: 1 },
    mockTransportState: { playheadPosition: 0, isPlaying: false },
}));

vi.mock('#/infra/store/useStore', () => ({
    useStore: vi.fn((store: unknown) => (store === mockWorkspaceStoreRef ? mockWorkspaceState : mockTransportState)),
}));

vi.mock('#/modules/WorkspaceShell/stores', () => ({
    workspaceStore: mockWorkspaceStoreRef,
    defaultWorkspaceState: { activeTool: 'pointer', snapValue: 1 },
}));

vi.mock('../../../helpers/automationViewHelpers', () => ({
    LANE_HEIGHT: 120,
    buildCurvePath: vi.fn(() => ''),
}));

/**
 * Two points four beats apart with distinct values, so the readout string at
 * any interior beat is a value neither endpoint carries.
 *   beat 1 -> 0.2 + 0.8 * 0.25 = 0.4 -> "40%"
 *   beat 3 -> 0.2 + 0.8 * 0.75 = 0.8 -> "80%"
 * The store's frozen 0 would read "20%".
 */
const lane: AutomationLane = {
    id: 'lane-1',
    trackId: 'track-1',
    parameterId: 'volume',
    parameterName: 'Volume',
    minValue: 0,
    maxValue: 1,
    points: [
        { beat: 0, value: 0.2, curve: 'linear', tension: 0 },
        { beat: 4, value: 1, curve: 'linear', tension: 0 },
    ],
    objects: [],
    visible: true,
    enabled: true,
    collapsed: false,
};

const laneProps = {
    lane,
    trackColor: '#ff0000',
    pixelsPerBeat: 12,
    scrollX: 0,
    containerWidth: 800,
};

/** The lane header's only percent-formatted badge is the value readout. */
const readReadout = (): string | null => screen.getByText(/^\d+%$/).textContent;

describe('AutomationLaneRow playhead value readout', () => {
    let frameCallbacks: FrameRequestCallback[] = [];
    let lastIssuedFrameId = 0;
    let cancelledFrameIds: number[] = [];

    beforeEach(() => {
        frameCallbacks = [];
        lastIssuedFrameId = 0;
        cancelledFrameIds = [];
        vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
            frameCallbacks.push(callback);
            lastIssuedFrameId = frameCallbacks.length;
            return lastIssuedFrameId;
        });
        vi.stubGlobal('cancelAnimationFrame', (id: number) => {
            cancelledFrameIds.push(id);
        });
        mockTransportState.playheadPosition = 0;
        mockTransportState.isPlaying = false;
        playheadPositionRef.current = 0;
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        playheadPositionRef.current = 0;
    });

    it('should read the high-frequency playhead ref, not the discrete transport store, on first paint', () => {
        // Playback started at beat 0 (all the store ever recorded) and the
        // scheduler has since advanced the ref to beat 3.
        mockTransportState.playheadPosition = 0;
        mockTransportState.isPlaying = true;
        playheadPositionRef.current = 3;

        render(<AutomationLaneRow {...laneProps} />);

        expect(readReadout()).toBe('80%');
    });

    it('should re-read the playhead ref on each animation frame while playing', () => {
        mockTransportState.playheadPosition = 0;
        mockTransportState.isPlaying = true;
        playheadPositionRef.current = 1;

        render(<AutomationLaneRow {...laneProps} />);
        expect(readReadout()).toBe('40%');

        // The scheduler advances the ref; no store write, no React re-render.
        playheadPositionRef.current = 3;
        const pending = [...frameCallbacks];
        frameCallbacks = [];
        act(() => {
            for (const callback of pending) {
                callback(1000);
            }
        });

        expect(readReadout()).toBe('80%');
    });

    it('should repaint the readout when a discrete seek moves the playhead while stopped', () => {
        mockTransportState.playheadPosition = 0;
        mockTransportState.isPlaying = false;
        playheadPositionRef.current = 1;

        const { rerender } = render(<AutomationLaneRow {...laneProps} />);
        expect(readReadout()).toBe('40%');

        // `executePlayheadSeek` writes both channels. No rAF loop is running,
        // and the Compiler will replay its memoized render, so the repaint has
        // to come from the effect re-firing on the store change.
        playheadPositionRef.current = 3;
        mockTransportState.playheadPosition = 3;
        act(() => {
            rerender(<AutomationLaneRow {...laneProps} />);
        });

        expect(readReadout()).toBe('80%');
        expect(frameCallbacks).toHaveLength(0);
    });

    it('should cancel the frame it is actually waiting on when unmounted mid-playback', () => {
        mockTransportState.playheadPosition = 0;
        mockTransportState.isPlaying = true;
        playheadPositionRef.current = 1;

        const { unmount } = render(<AutomationLaneRow {...laneProps} />);

        // Run two frames so the id issued at effect setup is stale and only the
        // id from the most recent re-request is still outstanding.
        act(() => {
            frameCallbacks[0]!(1000);
        });
        act(() => {
            frameCallbacks[1]!(2000);
        });
        const outstanding = lastIssuedFrameId;
        expect(outstanding).toBe(3);
        expect(cancelledFrameIds).toEqual([]);

        unmount();

        expect(cancelledFrameIds).toEqual([outstanding]);
    });

    it('should stop repainting the readout once unmounted', () => {
        mockTransportState.isPlaying = true;
        playheadPositionRef.current = 1;

        const { unmount } = render(<AutomationLaneRow {...laneProps} />);
        const badge = screen.getByText(/^\d+%$/);
        expect(badge.textContent).toBe('40%');

        unmount();

        // A frame that escapes cancellation would still find the detached node
        // and write to it; the readout must be left alone.
        playheadPositionRef.current = 3;
        act(() => {
            frameCallbacks[0]!(1000);
        });

        expect(badge.textContent).toBe('40%');
    });

    it('should not schedule an animation frame while the transport is stopped', () => {
        mockTransportState.isPlaying = false;
        playheadPositionRef.current = 3;

        render(<AutomationLaneRow {...laneProps} />);

        expect(readReadout()).toBe('80%');
        expect(frameCallbacks).toHaveLength(0);
    });
});
