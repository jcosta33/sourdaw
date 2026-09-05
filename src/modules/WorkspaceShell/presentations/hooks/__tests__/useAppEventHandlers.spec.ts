import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { Container } from '#/infra/di/Container';
import { importMidiFile } from '#/modules/Arrangement/useCases';
import { undo, redo } from '#/modules/Command/useCases';
import { captureProjectTransitionAuthority, saveProject, newProject } from '#/modules/Project/useCases';
import { confirmUser } from '#/utils/Notification/confirmUser';

import { setWorkspaceEventBus, type WorkspaceEventBus } from '../../../useCases/workspaceEventBus';
import { useAppEventHandlers } from '../useAppEventHandlers';

vi.mock('#/modules/Arrangement/useCases', () => ({ importMidiFile: vi.fn() }));
vi.mock('#/modules/Command/useCases', () => ({ undo: vi.fn(), redo: vi.fn(), executeUserAppAction: vi.fn() }));
const transition = vi.hoisted(() => ({ current: true }));
vi.mock('#/modules/Project/useCases', () => ({
    saveProject: vi.fn(),
    newProject: vi.fn(),
    captureProjectTransitionAuthority: vi.fn(() => ({ isCurrent: () => transition.current })),
}));
vi.mock('#/utils/Notification/confirmUser', () => ({ confirmUser: vi.fn() }));

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
    let reloadSpy: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        Container.clear();
        vi.clearAllMocks();
        transition.current = true;
        bus = createFakeEventBus();
        setWorkspaceEventBus(bus);
        onOpenExport = vi.fn<() => void>();
        onOpenPreferences = vi.fn<() => void>();
        reloadSpy = vi.fn();
        vi.stubGlobal('location', { ...window.location, reload: reloadSpy });
    });

    afterEach(() => {
        vi.unstubAllGlobals();
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

    it('saves the project on project.save', () => {
        renderHook(() => useAppEventHandlers({ onOpenExport, onOpenPreferences }));

        bus.fire('project.save');

        expect(vi.mocked(saveProject)).toHaveBeenCalledTimes(1);
    });

    it('undoes on command.undo and redoes on command.redo', () => {
        renderHook(() => useAppEventHandlers({ onOpenExport, onOpenPreferences }));

        bus.fire('command.undo');
        bus.fire('command.redo');

        expect(vi.mocked(undo)).toHaveBeenCalledTimes(1);
        expect(vi.mocked(redo)).toHaveBeenCalledTimes(1);
    });

    it('imports the MIDI file when midi.import carries a file', () => {
        renderHook(() => useAppEventHandlers({ onOpenExport, onOpenPreferences }));
        const file = new File(['midi'], 'song.mid');

        bus.fire('midi.import', { file });

        expect(vi.mocked(importMidiFile)).toHaveBeenCalledWith(file, { shouldContinue: expect.any(Function) });
        const options = vi.mocked(importMidiFile).mock.calls[0]?.[1];
        transition.current = false;
        expect(options?.shouldContinue()).toBe(false);
        expect(captureProjectTransitionAuthority).toHaveBeenCalledTimes(1);
    });

    it('does not import when midi.import carries no file', () => {
        renderHook(() => useAppEventHandlers({ onOpenExport, onOpenPreferences }));

        bus.fire('midi.import', { file: undefined });

        expect(vi.mocked(importMidiFile)).not.toHaveBeenCalled();
    });

    it('creates a new project and reloads when the user confirms project.new', async () => {
        vi.mocked(confirmUser).mockResolvedValue(true);
        renderHook(() => useAppEventHandlers({ onOpenExport, onOpenPreferences }));

        bus.fire('project.new');
        await vi.waitFor(() => {
            expect(vi.mocked(newProject)).toHaveBeenCalledTimes(1);
        });

        expect(vi.mocked(confirmUser)).toHaveBeenCalledWith(
            expect.objectContaining({ title: 'New project', variant: 'danger' })
        );
        expect(reloadSpy).toHaveBeenCalledTimes(1);
    });

    it('does not create a new project when the user cancels project.new', async () => {
        vi.mocked(confirmUser).mockResolvedValue(false);
        renderHook(() => useAppEventHandlers({ onOpenExport, onOpenPreferences }));

        bus.fire('project.new');
        await vi.waitFor(() => {
            expect(vi.mocked(confirmUser)).toHaveBeenCalledTimes(1);
        });

        expect(vi.mocked(newProject)).not.toHaveBeenCalled();
        expect(reloadSpy).not.toHaveBeenCalled();
    });

    it('unsubscribes every listener on unmount so later events are inert', () => {
        const { unmount } = renderHook(() => useAppEventHandlers({ onOpenExport, onOpenPreferences }));

        unmount();
        bus.fire('dialog.openExport');
        bus.fire('project.save');
        bus.fire('command.undo');

        expect(onOpenExport).not.toHaveBeenCalled();
        expect(vi.mocked(saveProject)).not.toHaveBeenCalled();
        expect(vi.mocked(undo)).not.toHaveBeenCalled();
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
