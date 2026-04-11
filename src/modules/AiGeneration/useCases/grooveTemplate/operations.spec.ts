import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { extractGroove } from './operations/extractGroove';

describe('extractGroove', () => {
    beforeEach(() => {
        Container.clear();
    });

    it('uses injected getAllTracks to resolve clip length', () => {
        const getAllTracks = vi.fn().mockReturnValue([]);
        injectDependencies(extractGroove, { getAllTracks });

        const template = extractGroove('clip-a', 8);

        expect(getAllTracks).toHaveBeenCalled();
        expect(template.subdivisions).toBe(8);
        expect(template.offsets.length).toBe(8);
    });
});
