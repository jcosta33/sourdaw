import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DawUtilityListRow } from '../DawUtilityListRow';

describe('DawUtilityListRow', () => {
    it('should call onPress when button', () => {
        const onPress = vi.fn();
        render(<DawUtilityListRow title="Row" onPress={onPress} />);
        fireEvent.click(screen.getByRole('button', { name: 'Row' }));
        expect(onPress).toHaveBeenCalled();
    });
});
