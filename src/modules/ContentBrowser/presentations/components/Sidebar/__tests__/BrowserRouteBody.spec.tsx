import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

import { BrowserRouteBody, BrowserRouteFooter, BrowserRouteSection } from '../BrowserRouteBody';

describe('BrowserRouteBody', () => {
    it('owns the route inset and card gap', () => {
        render(
            <BrowserRouteBody>
                <span>Card</span>
            </BrowserRouteBody>
        );

        const body = screen.getByTestId('browser-route-body');
        expect(body).toContainElement(screen.getByText('Card'));
        expect(body).toHaveClass('gap-1.5', 'px-1.5');
    });

    it('adds no route animation', () => {
        const { container } = render(
            <BrowserRouteBody>
                <BrowserRouteSection label="Group">
                    <span>Card</span>
                </BrowserRouteSection>
                <BrowserRouteFooter>
                    <span>Footer</span>
                </BrowserRouteFooter>
            </BrowserRouteBody>
        );

        expect(container.querySelectorAll('[class*="animate-in"]')).toHaveLength(0);
    });
});

describe('BrowserRouteSection', () => {
    it('renders its label ahead of its cards using the card gap', () => {
        render(
            <BrowserRouteSection label="Play Dough">
                <span>Card</span>
            </BrowserRouteSection>
        );

        const label = screen.getByText('Play Dough');
        const card = screen.getByText('Card');
        expect(label.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(card.parentElement).toHaveClass('gap-1.5');
    });
});

describe('BrowserRouteFooter', () => {
    it('renders its children under a rule', () => {
        render(
            <BrowserRouteFooter>
                <span>Footer</span>
            </BrowserRouteFooter>
        );

        expect(screen.getByText('Footer').parentElement).toHaveClass('border-t');
    });
});
