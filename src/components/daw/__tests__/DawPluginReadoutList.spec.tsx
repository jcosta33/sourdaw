import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { DawPluginReadoutList } from '../DawPluginReadoutList';

describe('DawPluginReadoutList', () => {
    it('should use tight spacing when density is tight', () => {
        const { container } = render(<DawPluginReadoutList density="tight">x</DawPluginReadoutList>);
        expect(container.firstChild).toHaveClass('space-y-1');
    });
});
