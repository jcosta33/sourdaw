import { afterEach, describe, expect, it, vi } from 'vitest';

import { Container } from '#/infra/di/Container';

import { WorkspaceEventBus } from '../../workspaceEventBus';
import { openPreferencesSection } from '../openPreferencesSection';

describe('openPreferencesSection', () => {
    afterEach(() => {
        Container.clear();
    });

    it('emits the Preferences open event carrying the requested section', () => {
        const emit = vi.fn(() => Promise.resolve());
        Container.set(WorkspaceEventBus, { emit, on: vi.fn() });

        openPreferencesSection({ section: 'midi' });

        expect(emit).toHaveBeenCalledWith('dialog.openPreferences', { section: 'midi' });
    });
});
