import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { SourdawLogo } from './SourdawLogo';

describe('SourdawLogo', () => {
    it('should render logo images', () => {
        const { container } = render(<SourdawLogo paused />);
        expect(container.querySelectorAll('img').length).toBeGreaterThan(0);
    });
});
