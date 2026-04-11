import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DawPluginChoiceRow } from '../DawPluginChoiceRow';

describe('DawPluginChoiceRow', () => {
    it('should call onPress from button', () => {
        const onPress = vi.fn();
        render(<DawPluginChoiceRow title="A" subtitle="sub" onPress={onPress} />);
        fireEvent.click(screen.getByRole('button', { name: /A/ }));
        expect(onPress).toHaveBeenCalled();
    });
});
