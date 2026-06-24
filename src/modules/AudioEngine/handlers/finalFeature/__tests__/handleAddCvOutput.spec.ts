import { describe, it, expect, vi, beforeEach } from 'vitest';

import { addCvOutput } from '#/modules/Synth/useCases';

import { handleAddCvOutput } from '../handleAddCvOutput';

vi.mock('#/modules/Synth/useCases', () => ({ addCvOutput: vi.fn() }));

describe('handleAddCvOutput', () => {
    beforeEach(() => {
        vi.clearAllMocks();
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
});
