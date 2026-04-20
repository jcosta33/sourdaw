import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { createDefaultPatch } from '../../../models/LevainPatch';
import { HumanizePanel } from '../HumanizePanel';

describe('HumanizePanel', () => {
    it('should render', () => {
        const patch = createDefaultPatch('violin-1');
        render(<HumanizePanel config={patch.humanize} onChange={vi.fn()} />);
        expect(screen.getByText(/humanization/i)).toBeInTheDocument();
    });
});
