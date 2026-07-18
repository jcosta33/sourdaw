import { render } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

import { SourdawLogo } from '../SourdawLogo';

describe('SourdawLogo', () => {
    it('should render logo images', () => {
        const { container } = render(<SourdawLogo paused />);
        expect(container.querySelectorAll('img').length).toBeGreaterThan(0);
    });
});
