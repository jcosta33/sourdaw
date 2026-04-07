import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DawPluginSectionHeader } from './DawPluginSectionHeader';

describe('DawPluginSectionHeader', () => {
    it('should render title and actions', () => {
        render(
            <DawPluginSectionHeader title="Macros" actions={<button type="button">add</button>} size="xs" />
        );
        expect(screen.getByText('Macros')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'add' })).toBeInTheDocument();
    });
});
