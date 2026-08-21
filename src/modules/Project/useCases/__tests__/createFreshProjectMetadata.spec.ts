import { afterEach, describe, expect, it, vi } from 'vitest';

import { isCanonicalProjectId } from '../../models/ProjectData';
import { createFreshProjectMetadata } from '../createFreshProjectMetadata';

describe('createFreshProjectMetadata', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it('gives same-tick template and demo projects distinct canonical identities', () => {
        vi.useFakeTimers();
        vi.setSystemTime(1_700_000_000_000);

        const template = createFreshProjectMetadata({
            name: 'Template Project',
            loading: true,
            initialized: false,
        });
        const demo = createFreshProjectMetadata({
            name: 'Nebula Drift (Demo)',
            loading: true,
            initialized: false,
        });

        expect(template.createdAt).toBe(demo.createdAt);
        expect(isCanonicalProjectId(template.projectId)).toBe(true);
        expect(isCanonicalProjectId(demo.projectId)).toBe(true);
        expect(template.projectId).not.toBe(demo.projectId);
    });
});
