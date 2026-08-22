import { act, renderHook } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { Container } from '#/infra/di/Container';

import { setWorkspaceEventBus, type WorkspaceEventBus } from '../../../useCases/workspaceEventBus';
import { useActiveDevicePanel } from '../useActiveDevicePanel';

type Handler = (payload: unknown) => void;

function createFakeEventBus(): WorkspaceEventBus & { fire: (event: string, payload?: unknown) => void } {
    const handlersByEvent = new Map<string, Set<Handler>>();
    return {
        emit: vi.fn().mockResolvedValue(undefined),
        on: vi.fn((event: string, handler: Handler) => {
            const set = handlersByEvent.get(event) ?? new Set<Handler>();
            set.add(handler);
            handlersByEvent.set(event, set);
            return () => {
                handlersByEvent.get(event)?.delete(handler);
            };
        }),
        fire(event: string, payload?: unknown) {
            for (const handler of handlersByEvent.get(event) ?? []) {
                handler(payload);
            }
        },
    };
}

type TrackStoreValue = {
    selectedTrackId: string | null;
    tracks: readonly { id: string; devices: readonly { id: string; type: string }[] }[];
} | null;

const trackStoreState = vi.hoisted(() => ({ value: null as TrackStoreValue }));
const trackStoreSubscribers = vi.hoisted(() => new Set<(value: TrackStoreValue) => void>());

vi.mock('#/modules/Arrangement/stores', () => ({
    trackStore: {
        get value() {
            return trackStoreState.value;
        },
        subscribe: vi.fn((callback: (value: TrackStoreValue) => void) => {
            trackStoreSubscribers.add(callback);
            return () => {
                trackStoreSubscribers.delete(callback);
            };
        }),
    },
}));

function setSelectedTrack(trackId: string | null): void {
    // `tracks` is present but empty: the yeast open path looks for the
    // selected track's Yeast device (issue #2422) and must find none.
    trackStoreState.value = { selectedTrackId: trackId, tracks: [] };
    for (const callback of trackStoreSubscribers) {
        callback(trackStoreState.value);
    }
}

describe('useActiveDevicePanel', () => {
    let bus: ReturnType<typeof createFakeEventBus>;

    beforeEach(() => {
        Container.clear();
        bus = createFakeEventBus();
        setWorkspaceEventBus(bus);
        trackStoreState.value = null;
        trackStoreSubscribers.clear();
    });

    it('starts with no active panel', () => {
        const { result } = renderHook(() => useActiveDevicePanel());

        expect(result.current.activePanel).toBeNull();
    });

    it('opens a device-bearing panel and captures the currently selected track', () => {
        setSelectedTrack('track-1');
        const { result } = renderHook(() => useActiveDevicePanel());

        act(() => {
            bus.fire('panel.showFermenter', { deviceId: 'fermenter-device-1' });
        });

        expect(result.current.activePanel).toEqual({
            kind: 'fermenter',
            deviceId: 'fermenter-device-1',
            trackId: 'track-1',
        });
    });

    it('closes the panel when the show event carries a null deviceId', () => {
        setSelectedTrack('track-1');
        const { result } = renderHook(() => useActiveDevicePanel());
        act(() => {
            bus.fire('panel.showToaster', { deviceId: 'toaster-1' });
        });
        expect(result.current.activePanel).not.toBeNull();

        act(() => {
            bus.fire('panel.showToaster', { deviceId: null });
        });

        expect(result.current.activePanel).toBeNull();
    });

    it('opens the yeast panel with a null deviceId, only the captured trackId', () => {
        setSelectedTrack('track-yeast');
        const { result } = renderHook(() => useActiveDevicePanel());

        act(() => {
            bus.fire('panel.showYeast', { deviceId: null });
        });

        // The mock track store carries no devices, so a null deviceId cannot
        // resolve to an instance — the panel falls back to selection itself.
        expect(result.current.activePanel).toEqual({ kind: 'yeast', deviceId: null, trackId: 'track-yeast' });
    });

    it('opens the yeast panel bound to the deviceId the event carried', () => {
        setSelectedTrack('track-yeast');
        const { result } = renderHook(() => useActiveDevicePanel());

        act(() => {
            bus.fire('panel.showYeast', { deviceId: 'yeast-9' });
        });

        expect(result.current.activePanel).toEqual({ kind: 'yeast', deviceId: 'yeast-9', trackId: 'track-yeast' });
    });

    it('opens a grinder panel through the generic onShowDevicePanel event', () => {
        setSelectedTrack('track-2');
        const { result } = renderHook(() => useActiveDevicePanel());

        act(() => {
            bus.fire('panel.showDevice', { deviceType: 'grinder', deviceId: 'grinder-1' });
        });

        expect(result.current.activePanel).toEqual({ kind: 'grinder', deviceId: 'grinder-1', trackId: 'track-2' });
    });

    it('ignores generic panel.showDevice events for unrelated device types', () => {
        const { result } = renderHook(() => useActiveDevicePanel());

        act(() => {
            bus.fire('panel.showDevice', { deviceType: 'sampler', deviceId: 'sampler-1' });
        });

        expect(result.current.activePanel).toBeNull();
    });

    it('closes the panel when the track selection changes away from the captured track', () => {
        setSelectedTrack('track-1');
        const { result } = renderHook(() => useActiveDevicePanel());
        act(() => {
            bus.fire('panel.showFermenter', { deviceId: 'device-1' });
        });
        expect(result.current.activePanel).not.toBeNull();

        act(() => {
            setSelectedTrack('track-2');
        });

        expect(result.current.activePanel).toBeNull();
    });

    it('keeps the panel open when the track selection changes but matches the captured track', () => {
        setSelectedTrack('track-1');
        const { result } = renderHook(() => useActiveDevicePanel());
        act(() => {
            bus.fire('panel.showFermenter', { deviceId: 'device-1' });
        });

        act(() => {
            // Re-emitting the same selection must be a no-op, not a close.
            setSelectedTrack('track-1');
        });

        expect(result.current.activePanel).toEqual({ kind: 'fermenter', deviceId: 'device-1', trackId: 'track-1' });
    });

    it('keeps a global panel (opened with no active track) open across track selection changes', () => {
        setSelectedTrack(null);
        const { result } = renderHook(() => useActiveDevicePanel());
        act(() => {
            bus.fire('panel.showLevain', { deviceId: 'levain-1' });
        });
        expect(result.current.activePanel).toEqual({ kind: 'levain', deviceId: 'levain-1', trackId: null });

        act(() => {
            setSelectedTrack('track-1');
        });

        expect(result.current.activePanel).toEqual({ kind: 'levain', deviceId: 'levain-1', trackId: null });
    });

    it('is a no-op to change track selection when no panel is open', () => {
        const { result } = renderHook(() => useActiveDevicePanel());

        act(() => {
            setSelectedTrack('track-1');
        });

        expect(result.current.activePanel).toBeNull();
    });

    it('closeActivePanel clears the currently open panel', () => {
        setSelectedTrack('track-1');
        const { result } = renderHook(() => useActiveDevicePanel());
        act(() => {
            bus.fire('panel.showFermenter', { deviceId: 'device-1' });
        });
        expect(result.current.activePanel).not.toBeNull();

        act(() => {
            result.current.closeActivePanel();
        });

        expect(result.current.activePanel).toBeNull();
    });

    it('unsubscribes from all events and the track store on unmount', () => {
        const { result, unmount } = renderHook(() => useActiveDevicePanel());
        expect(trackStoreSubscribers.size).toBe(1);

        unmount();
        bus.fire('panel.showFermenter', { deviceId: 'device-1' });

        expect(trackStoreSubscribers.size).toBe(0);
        expect(result.current.activePanel).toBeNull();
    });
});
