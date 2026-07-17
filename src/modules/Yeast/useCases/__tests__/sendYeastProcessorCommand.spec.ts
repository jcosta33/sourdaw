import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = vi.hoisted(() => ({
    value: {
        processors: [
            {
                id: 'cm-1',
                type: 'chordMemory' as const,
                name: 'Chord Memory',
                bypassed: false,
                params: { transpose_mode: 1 },
            },
        ],
        uiLevel: 2 as const,
    },
}));

type RuntimeDeliveryResult = { delivered: true } | { delivered: false; reason: string };

const sendRuntimeCommand = vi.hoisted(() =>
    vi.fn<(command: unknown) => Promise<RuntimeDeliveryResult>>(() => Promise.resolve({ delivered: true }))
);

vi.mock('../../stores/yeastStore', () => ({ yeastStore: store }));
vi.mock('../../engine/yeastRuntime', () => ({ sendYeastRuntimeCommand: sendRuntimeCommand }));

const { sendYeastProcessorCommand } = await import('../sendYeastProcessorCommand');

describe('sendYeastProcessorCommand', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it.each([
        ['learn', 'chordMemory.learn'],
        ['clear', 'chordMemory.clear'],
    ] as const)('routes %s as a typed one-shot runtime command', async (command, type) => {
        await expect(sendYeastProcessorCommand('cm-1', command)).resolves.toEqual({ delivered: true });

        expect(sendRuntimeCommand).toHaveBeenCalledWith({ processorId: 'cm-1', type });
    });

    it('does not touch the serializable processor projection', async () => {
        await sendYeastProcessorCommand('cm-1', 'learn');

        expect(store.value.processors[0]?.params).toEqual({ transpose_mode: 1 });
    });

    it('surfaces runtime delivery failure to the caller', async () => {
        sendRuntimeCommand.mockResolvedValueOnce({ delivered: false, reason: 'runtime-unavailable' });

        await expect(sendYeastProcessorCommand('cm-1', 'clear')).resolves.toEqual({
            delivered: false,
            reason: 'runtime-unavailable',
        });
    });
});
