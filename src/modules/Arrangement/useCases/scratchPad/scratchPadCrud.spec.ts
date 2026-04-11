import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { addScratchPadSection } from './scratchPadCrud/addScratchPadSection';
import { clearScratchPad } from './scratchPadCrud/clearScratchPad';

describe('scratchPadCrud', () => {
    beforeEach(() => {
        Container.clear();
    });

    it('addScratchPadSection appends a section', () => {
        const set = vi.fn();
        injectDependencies(addScratchPadSection, {
            scratchPadStore: {
                value: { sections: [] },
                set,
            } as never,
        });
        addScratchPadSection(0, 4, 'A', '#fff');
        expect(set).toHaveBeenCalledTimes(1);
        const next = set.mock.calls[0]![0] as { sections: { name: string }[] };
        expect(next.sections).toHaveLength(1);
        expect(next.sections[0]!.name).toBe('A');
    });

    it('clearScratchPad empties sections', () => {
        const set = vi.fn();
        injectDependencies(clearScratchPad, {
            scratchPadStore: {
                value: { sections: [{ id: 'x' } as never] },
                set,
            } as never,
        });
        clearScratchPad();
        expect(set).toHaveBeenCalledWith({ sections: [] });
    });
});
