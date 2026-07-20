import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { GrooveTemplateLifecycleControls } from '../GrooveTemplateLifecycleControls';

describe('GrooveTemplateLifecycleControls', () => {
    it('resets an edited input when the canonical name changes for the same template ID', () => {
        const view = render(<GrooveTemplateLifecycleControls templateId="template-1" templateName="Original" />);
        const nameInput = screen.getByRole('textbox', { name: 'Groove template name' });
        fireEvent.change(nameInput, { target: { value: 'Unsaved local edit' } });

        view.rerender(<GrooveTemplateLifecycleControls templateId="template-1" templateName="Restored name" />);

        expect(screen.getByRole('textbox', { name: 'Groove template name' })).toHaveValue('Restored name');
    });
});
