import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { HumanizePanel } from '../HumanizePanel';
import { createDefaultPatch } from '../../../models/LevainPatch';

describe('HumanizePanel', () => {
    it('should render', () => {
        const patch = createDefaultPatch('violin-1');
        render(<HumanizePanel config={patch.humanize} onChange={vi.fn()} />);
        expect(screen.getByText(/humanization/i)).toBeInTheDocument();
    });
});
