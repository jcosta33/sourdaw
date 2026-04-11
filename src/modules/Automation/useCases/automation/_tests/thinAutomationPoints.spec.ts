import { describe, it, expect, vi } from 'vitest';
import { thinAutomationPoints } from '../thinAutomationPoints';

const { mocks } = vi.hoisted(() => ({
    mocks: {
        rdpSimplify: vi.fn(),
    }
}));

vi.mock('#/modules/Arrangement/useCases', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/Arrangement/useCases')>();
    return {
        ...actual,
        rdpSimplify: mocks.rdpSimplify,
    };
});

describe('thinAutomationPoints', () => {
    it('does not call rdpSimplify when automation store is empty', () => {
        thinAutomationPoints('lane-1');

        expect(mocks.rdpSimplify).not.toHaveBeenCalled();
    });
});
