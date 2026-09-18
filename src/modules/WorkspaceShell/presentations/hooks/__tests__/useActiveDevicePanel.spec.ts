import { act, renderHook } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { Container } from '#/infra/di/Container';

import { showDevicePanelForType } from '../../../useCases/panels/devicePanels/showDevicePanelForType';
import { setWorkspaceEventBus, type WorkspaceEventBus } from '../../../useCases/workspaceEventBus';
import { useActiveDevicePanel } from '../useActiveDevicePanel';

type Handler = (payload: unknown) => void;

type EmittedEvent = { event: string; payload: unknown };

function createFakeEventBus(): WorkspaceEventBus & {
    fire: (event: string, payload?: unknown) => void;
    emitted: EmittedEvent[];
} {
    const handlersByEvent = new Map<string, Set<Handler>>();
    const emitted: EmittedEvent[] = [];
    return {
        emit: vi.fn((event: string, payload: unknown) => {
            emitted.push({ event, payload });
            for (const handler of handlersByEvent.get(event) ?? []) {
                handler(payload);
            }
            return Promise.resolve();
        }),
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
        emitted,
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
            bus.fire('panel.showDevice', { deviceType: 'fermenter', deviceId: 'fermenter-device-1' });
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
            bus.fire('panel.showDevice', { deviceType: 'toaster', deviceId: 'toaster-1' });
        });
        expect(result.current.activePanel).not.toBeNull();

        act(() => {
            bus.fire('panel.showDevice', { deviceType: 'toaster', deviceId: null });
        });

        expect(result.current.activePanel).toBeNull();
    });

    it('opens the yeast panel with a null deviceId, only the captured trackId', () => {
        setSelectedTrack('track-yeast');
        const { result } = renderHook(() => useActiveDevicePanel());

        act(() => {
            bus.fire('panel.showDevice', { deviceType: 'yeast', deviceId: null });
        });

        // The mock track store carries no devices, so a null deviceId cannot
        // resolve to an instance — the panel falls back to selection itself.
        expect(result.current.activePanel).toEqual({ kind: 'yeast', deviceId: null, trackId: 'track-yeast' });
    });

    it('opens the yeast panel bound to the deviceId the event carried', () => {
        setSelectedTrack('track-yeast');
        const { result } = renderHook(() => useActiveDevicePanel());

        act(() => {
            bus.fire('panel.showDevice', { deviceType: 'yeast', deviceId: 'yeast-9' });
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

        // `automation` rides the same event (AppShell routes it to the bottom
        // dock) but owns no device panel, so the hook must let it pass by.
        act(() => {
            bus.fire('panel.showDevice', { deviceType: 'automation', deviceId: null });
        });

        expect(result.current.activePanel).toBeNull();
    });

    it('opens a representative panel end-to-end through the generic event alone', async () => {
        setSelectedTrack('track-1');
        const { result } = renderHook(() => useActiveDevicePanel());

        act(() => {
            showDevicePanelForType('fermenter', 'fermenter-device-1');
        });

        expect(result.current.activePanel).toEqual({
            kind: 'fermenter',
            deviceId: 'fermenter-device-1',
            trackId: 'track-1',
        });
        // The open travelled on exactly one event — the generic one, with no
        // per-device twin alongside it.
        expect(bus.emitted).toEqual([
            { event: 'panel.showDevice', payload: { deviceType: 'fermenter', deviceId: 'fermenter-device-1' } },
        ]);
    });

    it('closes the panel when the track selection changes away from the captured track', () => {
        setSelectedTrack('track-1');
        const { result } = renderHook(() => useActiveDevicePanel());
        act(() => {
            bus.fire('panel.showDevice', { deviceType: 'fermenter', deviceId: 'device-1' });
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
            bus.fire('panel.showDevice', { deviceType: 'fermenter', deviceId: 'device-1' });
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
            bus.fire('panel.showDevice', { deviceType: 'levain', deviceId: 'levain-1' });
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
            bus.fire('panel.showDevice', { deviceType: 'fermenter', deviceId: 'device-1' });
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
        bus.fire('panel.showDevice', { deviceType: 'fermenter', deviceId: 'device-1' });

        expect(trackStoreSubscribers.size).toBe(0);
        expect(result.current.activePanel).toBeNull();
    });
});
