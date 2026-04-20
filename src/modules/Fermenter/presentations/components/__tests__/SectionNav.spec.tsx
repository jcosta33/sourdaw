import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { SectionNav } from '../SectionNav';

describe('SectionNav', () => {
    it('should render', () => {
        const onChange = vi.fn();
        render(<SectionNav active="osc" onChange={onChange} />);
        fireEvent.click(screen.getByRole('button', { name: /filter/i }));
        expect(onChange).toHaveBeenCalledWith('filter');
    });
});
