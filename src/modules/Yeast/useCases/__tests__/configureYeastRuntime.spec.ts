import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Container } from '#/infra/di/Container';

vi.mock('../../engine/yeastRuntime', () => ({
    setYeastRuntimeNotesOffHandler: vi.fn(),
    setYeastRuntimeOutputPanicHandler: vi.fn(),
}));

import { setYeastRuntimeNotesOffHandler, setYeastRuntimeOutputPanicHandler } from '../../engine/yeastRuntime';
import { setYeastEventBus, type YeastEventBus } from '../../stores/yeastEventBus';
import { configureYeastRuntime } from '../configureYeastRuntime';

function createFakeEventBus(): YeastEventBus & { emit: ReturnType<typeof vi.fn> } {
    return { emit: vi.fn().mockResolvedValue(undefined) };
}

describe('configureYeastRuntime', () => {
    beforeEach(() => {
        Container.clear();
        vi.mocked(setYeastRuntimeNotesOffHandler).mockClear();
        vi.mocked(setYeastRuntimeOutputPanicHandler).mockClear();
    });

    it('installs an output-panic handler that forwards to the supplied callback', () => {
        const panicOutputNotes = vi.fn();
        setYeastEventBus(createFakeEventBus());

        configureYeastRuntime({ panicOutputNotes });

        expect(setYeastRuntimeOutputPanicHandler).toHaveBeenCalledTimes(1);
        const installedHandler = vi.mocked(setYeastRuntimeOutputPanicHandler).mock.calls[0]?.[0];
        installedHandler?.();

        expect(panicOutputNotes).toHaveBeenCalledTimes(1);
    });

    it('emits yeast.notesOff on the event bus only for payloads with pending note-offs', () => {
        const bus = createFakeEventBus();
        setYeastEventBus(bus);

        configureYeastRuntime({ panicOutputNotes: vi.fn() });

        expect(setYeastRuntimeNotesOffHandler).toHaveBeenCalledTimes(1);
        const installedHandler = vi.mocked(setYeastRuntimeNotesOffHandler).mock.calls[0]?.[0];
        installedHandler?.([
            { trackId: 'track-a', noteOffs: [{ channel: 0, note: 60 }] },
            { trackId: 'track-b', noteOffs: [] },
        ]);

        expect(bus.emit).toHaveBeenCalledTimes(1);
        expect(bus.emit).toHaveBeenCalledWith('yeast.notesOff', {
            trackId: 'track-a',
            noteOffs: [{ channel: 0, note: 60 }],
        });
    });
});
