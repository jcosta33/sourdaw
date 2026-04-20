import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { PresetBrowser } from '../PresetBrowser';

describe('PresetBrowser', () => {
    it('should render', () => {
        render(
            <PresetBrowser
                currentName="Init"
                userPatches={[{ id: 'u1', name: 'Mine' }]}
                presets={[{ id: 'p1', name: 'Lead', category: 'lead', tags: [] }]}
                onLoadPreset={vi.fn()}
            />
        );
        expect(screen.getByPlaceholderText(/search/i)).toBeInTheDocument();
    });
});
