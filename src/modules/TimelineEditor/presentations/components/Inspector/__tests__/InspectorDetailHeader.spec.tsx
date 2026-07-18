import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { InspectorDetailHeader } from '../InspectorDetailHeader';

describe('InspectorDetailHeader', () => {
    it('should call onBack when back is activated', () => {
        const onBack = vi.fn();
        render(<InspectorDetailHeader title="Details" onBack={onBack} backLabel="Go back to list" />);
        fireEvent.click(screen.getByRole('button', { name: 'Go back to list' }));
        expect(onBack).toHaveBeenCalledTimes(1);
    });
});
