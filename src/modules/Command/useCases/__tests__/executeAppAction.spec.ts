import { describe, it, expect, vi, beforeEach } from 'vitest';

import { clearHandlerRegistry, registerHandlerMap } from '../../stores/handlerRegistry';
import { executeAppAction } from '../executeAppAction';

const mocks = vi.hoisted(() => ({
    logger: {
        error: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn(),
        setWriters: vi.fn(),
    },
    setSemanticContext: vi.fn(),
    clearSemanticContext: vi.fn(),
    pushActionHistoryEntry: vi.fn(),
    pushUndo: vi.fn(),
    recordAction: vi.fn(),
    mockHandler: {
        execute: vi.fn(),
        describe: vi.fn(() => ({ label: 'Mock Label' })),
        undoable: true,
    },
}));

vi.mock('#/infra/logger/appLogger', () => ({ logger: mocks.logger }));

vi.mock('#/modules/CrdtDocument/stores', async (importOriginal) => ({
    ...(await importOriginal<any>()),
    pushActionHistoryEntry: mocks.pushActionHistoryEntry,
    setSemanticContext: mocks.setSemanticContext,
    clearSemanticContext: mocks.clearSemanticContext,
}));

vi.mock('../../stores/undoStore', () => ({
    pushUndo: mocks.pushUndo,
    undoStore: { value: {} },
}));

vi.mock('../macro/recording/recordAction', () => ({ recordAction: mocks.recordAction }));

describe('executeAppAction', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        clearHandlerRegistry();
        registerHandlerMap({ testAction: mocks.mockHandler as any });
    });

    it('logs error if no handler is found', async () => {
        clearHandlerRegistry();
        await executeAppAction({ type: 'unknownAction', payload: {} } as any);
        expect(mocks.logger.error).toHaveBeenCalled();
    });

    it('executes a registered handler', async () => {
        await executeAppAction({ type: 'testAction', payload: { foo: 'bar' } } as any);

        expect(mocks.mockHandler.execute).toHaveBeenCalledWith({ type: 'testAction', payload: { foo: 'bar' } });
        expect(mocks.setSemanticContext).toHaveBeenCalledWith(expect.objectContaining({ message: 'Mock Label' }));
        expect(mocks.pushUndo).toHaveBeenCalled();
        expect(mocks.pushActionHistoryEntry).toHaveBeenCalled();
    });
});
