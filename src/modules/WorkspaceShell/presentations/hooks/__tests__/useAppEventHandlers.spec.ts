import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { Container } from '#/infra/di/Container';

import { setWorkspaceEventBus, type WorkspaceEventBus } from '../../../useCases/workspaceEventBus';
import { useAppEventHandlers } from '../useAppEventHandlers';

// A minimal in-process bus: `on` records the handler keyed by event name so
// tests can fire it directly, mirroring how the real DI-backed bus dispatches.
type Handler = (payload: unknown) => void | Promise<void>;

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
                void handler(payload);
            }
        },
    };
}

describe('useAppEventHandlers', () => {
    let bus: ReturnType<typeof createFakeEventBus>;
    let onOpenExport: ReturnType<typeof vi.fn<() => void>>;
    let onOpenPreferences: ReturnType<typeof vi.fn<() => void>>;

    beforeEach(() => {
        Container.clear();
        vi.clearAllMocks();
        bus = createFakeEventBus();
        setWorkspaceEventBus(bus);
        onOpenExport = vi.fn<() => void>();
        onOpenPreferences = vi.fn<() => void>();
    });

    it('forwards dialog.openExport to the onOpenExport callback', () => {
        renderHook(() => useAppEventHandlers({ onOpenExport, onOpenPreferences }));

        bus.fire('dialog.openExport');

        expect(onOpenExport).toHaveBeenCalledTimes(1);
        expect(onOpenPreferences).not.toHaveBeenCalled();
    });

    it('forwards dialog.openPreferences to the onOpenPreferences callback', () => {
        renderHook(() => useAppEventHandlers({ onOpenExport, onOpenPreferences }));

        bus.fire('dialog.openPreferences');

        expect(onOpenPreferences).toHaveBeenCalledTimes(1);
        expect(onOpenExport).not.toHaveBeenCalled();
    });

    it('unsubscribes every listener on unmount so later events are inert', () => {
        const { unmount } = renderHook(() => useAppEventHandlers({ onOpenExport, onOpenPreferences }));

        unmount();
        bus.fire('dialog.openExport');
        bus.fire('dialog.openPreferences');

        expect(onOpenExport).not.toHaveBeenCalled();
        expect(onOpenPreferences).not.toHaveBeenCalled();
    });

    it('re-subscribes when the callbacks change identity', () => {
        const { rerender } = renderHook(
            ({ onExport, onPreferences }) =>
                useAppEventHandlers({ onOpenExport: onExport, onOpenPreferences: onPreferences }),
            { initialProps: { onExport: onOpenExport, onPreferences: onOpenPreferences } }
        );
        const nextOnOpenExport = vi.fn<() => void>();

        rerender({ onExport: nextOnOpenExport, onPreferences: onOpenPreferences });
        bus.fire('dialog.openExport');

        expect(nextOnOpenExport).toHaveBeenCalledTimes(1);
        expect(onOpenExport).not.toHaveBeenCalled();
    });
});
