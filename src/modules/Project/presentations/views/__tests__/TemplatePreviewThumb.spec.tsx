import { render } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

import { TemplatePreviewThumb } from '../TemplatePreviewThumb';

describe('TemplatePreviewThumb', () => {
    it('renders an svg for a known template', () => {
        const { container } = render(<TemplatePreviewThumb templateId="pop-song" />);
        const svg = container.querySelector('svg');
        expect(svg).not.toBeNull();
        expect(svg?.getAttribute('width')).toBe('120');
        expect(svg?.getAttribute('height')).toBe('40');
    });

    it('renders a minimal svg when no preview loop matches the template id', () => {
        const { container } = render(<TemplatePreviewThumb templateId="does-not-exist" />);
        const svg = container.querySelector('svg');
        expect(svg).not.toBeNull();
        const rects = svg?.querySelectorAll('rect') ?? [];
        expect(rects.length).toBeGreaterThanOrEqual(1);
    });

    it('renders one rect per event plus a background', () => {
        const { container } = render(<TemplatePreviewThumb templateId="podcast" />);
        const rects = container.querySelectorAll('rect');
        expect(rects.length).toBeGreaterThanOrEqual(2);
    });
});
