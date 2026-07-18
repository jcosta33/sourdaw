import { describe, it, expect, vi } from 'vitest';

import { deselectAllClips } from '../deselectAllClips';

const mocks = vi.hoisted(() => ({
    clearClipSelection: vi.fn(),
}));

vi.mock('#/modules/Arrangement/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Arrangement/useCases')>()),
    clearClipSelection: mocks.clearClipSelection,
}));

describe('deselectAllClips', () => {
    it('delegates to the Arrangement clearClipSelection use case', () => {
        deselectAllClips();
        expect(mocks.clearClipSelection).toHaveBeenCalledTimes(1);
    });
});
