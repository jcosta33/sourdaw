import { expect } from 'vitest';

export const expectExternalProjectLink = (link: HTMLElement, href: string): void => {
    expect(link).toHaveAttribute('href', href);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
};
