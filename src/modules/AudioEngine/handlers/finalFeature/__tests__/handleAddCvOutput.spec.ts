import { describe, it, expect, vi, beforeEach } from 'vitest';

import { type CvGateState } from '#/modules/CvGate/stores';
import { addCvOutput } from '#/modules/CvGate/useCases';
import { type AppAction } from '#/utils/handlerContract';

import { handleAddCvOutput } from '../handleAddCvOutput';

const mocks = vi.hoisted(() => ({
    cvGateStore: {
        value: { outputs: [] as Array<{ id: string; outputChannel: number }> },
    },
}));

vi.mock('#/modules/CvGate/stores', () => ({ cvGateStore: mocks.cvGateStore }));
vi.mock('#/modules/CvGate/useCases', () => ({ addCvOutput: vi.fn() }));

function storeWithOutputs(outputs: CvGateState['outputs']): void {
    mocks.cvGateStore.value.outputs = outputs;
}

describe('handleAddCvOutput', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        storeWithOutputs([]);
    });

    it('forwards name, channel and type to addCvOutput', () => {
        void handleAddCvOutput.execute({
            type: 'addCvOutput',
            payload: { name: 'Gate 1', channel: 0, type: 'gate' },
        });
        expect(addCvOutput).toHaveBeenCalledWith('Gate 1', 0, 'gate');
    });

    it('forwards an unvalidated type string unchanged — validation is the use case’s job', () => {
        // The action payload types `type` as a bare `string`; the handler casts
        // it without narrowing. It must pass an unknown value straight through
        // (and not throw) so that addCvOutput can reject it at the root.
        expect(() => {
            void handleAddCvOutput.execute({
                type: 'addCvOutput',
                payload: { name: 'Bogus', channel: 3, type: 'not-a-real-type' },
            });
        }).not.toThrow();
        expect(addCvOutput).toHaveBeenCalledWith('Bogus', 3, 'not-a-real-type');
    });

    it('returns no-write when the store shows no output landed on the channel', () => {
        // The mocked use case writes nothing, so the post-write lookup finds no
        // output on the channel — the invalid-type/no-write refusal shape.
        const result = handleAddCvOutput.execute({
            type: 'addCvOutput',
            payload: { name: 'Gate 2', channel: 4, type: 'gate' },
        });
        expect(result).toEqual({ status: 'no-write' });
        expect(addCvOutput).toHaveBeenCalledWith('Gate 2', 4, 'gate');
    });

    it('returns no-write when the channel is already occupied — the add was refused', () => {
        // A duplicate channel makes the use case refuse silently; the pre-existing
        // output must never be mistaken for the added one, or undo would remove it.
        storeWithOutputs([{ id: 'cv-existing', outputChannel: 4 } as CvGateState['outputs'][number]]);
        const result = handleAddCvOutput.execute({
            type: 'addCvOutput',
            payload: { name: 'Gate 2', channel: 4, type: 'gate' },
        });
        expect(result).toEqual({ status: 'no-write' });
        expect(addCvOutput).toHaveBeenCalledWith('Gate 2', 4, 'gate');
    });

    it('reports written and fills the removeCvOutput inverse payload by reference', () => {
        const action: Extract<AppAction, { type: 'addCvOutput' }> = {
            type: 'addCvOutput',
            payload: { name: 'Pitch 1', channel: 1, type: 'cv-pitch' },
        };
        const described = handleAddCvOutput.describe(action);
        expect(described.label).toBe('Add CV/Gate Output');
        expect(described.inverseAction?.type).toBe('removeCvOutput');
        const inversePayload = described.inverseAction?.payload;
        expect(inversePayload).toEqual({ outputId: '' });

        // The write lands inside the mocked use case call, exactly where the
        // real addCvOutput would commit — after the handler's pre-write capture.
        vi.mocked(addCvOutput).mockImplementationOnce(() => {
            storeWithOutputs([{ id: 'cv-written', outputChannel: 1 } as CvGateState['outputs'][number]]);
        });
        expect(handleAddCvOutput.execute(action)).toEqual({ status: 'written' });

        // Same action object → describe hands back the same payload object, now
        // carrying the written id.
        expect(handleAddCvOutput.describe(action).inverseAction?.payload).toBe(inversePayload);
        expect(inversePayload).toEqual({ outputId: 'cv-written' });
    });
});
