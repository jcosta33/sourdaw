import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DawPluginRail } from '../DawPluginRail';

describe('DawPluginRail', () => {
    it('should render as aside by default', () => {
        render(<DawPluginRail>rail</DawPluginRail>);
        expect(screen.getByText('rail').closest('aside')).not.toBeNull();
    });
});
