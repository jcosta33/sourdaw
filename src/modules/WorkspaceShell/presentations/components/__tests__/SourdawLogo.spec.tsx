import { render } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

import { SourdawLogo } from '../SourdawLogo';

describe('SourdawLogo', () => {
    it('should render logo images', () => {
        const { container } = render(<SourdawLogo paused />);
        expect(container.querySelectorAll('img').length).toBeGreaterThan(0);
    });
});

describe('SourdawLogo — image structure', () => {
    it('renders the loaf image', () => {
        const { container } = render(<SourdawLogo paused />);
        const imgs = container.querySelectorAll('img');
        const loafSrcs = Array.from(imgs).filter((img) => img.getAttribute('src')?.includes('loaf'));
        expect(loafSrcs.length).toBe(1);
    });

    it('renders multiple particle images', () => {
        const { container } = render(<SourdawLogo paused />);
        const imgs = container.querySelectorAll('img');
        const particleSrcs = Array.from(imgs).filter((img) => {
            const src = img.getAttribute('src') ?? '';
            return src.includes('/logo-parts/p') && !src.includes('loaf');
        });
        expect(particleSrcs.length).toBeGreaterThan(5);
    });

    it('applies the className prop', () => {
        const { container } = render(<SourdawLogo className="custom-logo-class" paused />);
        const wrapper = container.querySelector('.custom-logo-class');
        expect(wrapper).toBeTruthy();
    });

    it('renders images from /logo-parts/ directory', () => {
        const { container } = render(<SourdawLogo paused />);
        const imgs = container.querySelectorAll('img');
        for (const img of Array.from(imgs)) {
            const src = img.getAttribute('src') ?? '';
            expect(src).toContain('/logo-parts/');
        }
    });
});
