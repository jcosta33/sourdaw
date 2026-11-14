import { describe, expect, it, vi } from 'vitest';

import { loadBasicPitchModel } from '../loadBasicPitchModel';

const state = vi.hoisted(() => ({ model: Promise.resolve({}), constructor: vi.fn() }));

vi.mock('@spotify/basic-pitch', () => ({
    BasicPitch: class {
        model = state.model;
        constructor(url: unknown) {
            state.constructor(url);
        }
    },
}));
vi.mock('virtual:sourdaw-basic-pitch-model', () => ({ modelUrl: '/model/model.json' }));

describe('loadBasicPitchModel', () => {
    it('waits for the public model promise and rejects when its load fails', async () => {
        const model = Promise.withResolvers<object>();
        state.model = model.promise;
        const failure = new Error('model load failed');
        const result = loadBasicPitchModel();
        const outcome = result.then(
            () => 'resolved',
            (error: unknown) => error
        );
        await vi.waitFor(() => expect(state.constructor).toHaveBeenCalled());
        model.reject(failure);
        await expect(outcome).resolves.toBe(failure);
        expect(state.constructor).toHaveBeenCalledWith('/model/model.json');
    });
});
