import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { YeastState } from '../../stores/yeastStore';

const store = vi.hoisted((): { value: YeastState | undefined } => ({
    value: {
        processors: [
            {
                id: 'cm-1',
                type: 'chordMemory',
                name: 'Chord Memory',
                bypassed: false,
                params: { transpose_mode: 1 },
            },
        ],
        uiLevel: 2,
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

        expect(store.value?.processors[0]?.params).toEqual({ transpose_mode: 1 });
    });

    it('surfaces runtime delivery failure to the caller', async () => {
        sendRuntimeCommand.mockResolvedValueOnce({ delivered: false, reason: 'runtime-unavailable' });

        await expect(sendYeastProcessorCommand('cm-1', 'clear')).resolves.toEqual({
            delivered: false,
            reason: 'runtime-unavailable',
        });
    });

    it('rejects delivery when the processor id is not in the store', async () => {
        await expect(sendYeastProcessorCommand('missing-id', 'learn')).resolves.toEqual({
            delivered: false,
            reason: 'processor-not-found',
        });
        // The typed command never reaches the runtime for an unknown processor.
        expect(sendRuntimeCommand).not.toHaveBeenCalled();
    });

    it('rejects delivery for a processor type that has no one-shot command', async () => {
        // Chord Memory is the only type with one-shot commands; a transposer
        // cannot receive a learn/clear command.
        const previous = store.value;
        store.value = {
            processors: [
                { id: 'trans-1', type: 'transposer' as const, name: 'Transposer', bypassed: false, params: {} },
            ],
            uiLevel: 2 as const,
        };
        try {
            await expect(sendYeastProcessorCommand('trans-1', 'learn')).resolves.toEqual({
                delivered: false,
                reason: 'unsupported-processor',
            });
            expect(sendRuntimeCommand).not.toHaveBeenCalled();
        } finally {
            store.value = previous;
        }
    });

    it('does not mutate the processor projection for a missing processor', async () => {
        await sendYeastProcessorCommand('missing-id', 'clear');
        expect(store.value?.processors[0]?.params).toEqual({ transpose_mode: 1 });
    });
});
