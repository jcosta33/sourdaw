/* (c) Copyright Frontify Ltd., all rights reserved. */

import { forwardRef, isValidElement, type ReactNode, type ReactElement, type ForwardedRef } from 'react';
import { describe, it, expect } from 'vitest';

import { getSlotsByComponentType } from './slots';

describe('getSlotsByComponentType', () => {
    const Header = () => <header>Header</header>;
    const Footer = () => <footer>Footer</footer>;
    const Content = () => <main>Content</main>;
    const UnmatchedComponent = () => <div>Unmatched</div>;

    const Button = ({ children }: { children?: ReactNode }, ref: ForwardedRef<HTMLButtonElement>) => (
        <div data-test-id="forward-header">
            <button type="button" ref={ref} />
            {children}
        </div>
    );
    const ForwardButton = forwardRef<HTMLButtonElement, { children?: ReactNode }>(Button);
    ForwardButton.displayName = 'ForwardButton';

    it('should correctly organize children into slots based on component types', () => {
        const children = [
            <Header key="header" />,
            <Content key="content" />,
            <Footer key="footer" />,
            <ForwardButton key="forwardButton" />,
        ];

        const result = getSlotsByComponentType(children, [Header, Footer, ForwardButton]);

        const [header, footer, forwardInput, unassigned] = result;

        expect(header).toBeDefined();
        expect(footer).toBeDefined();
        expect(forwardInput).toBeDefined();
        expect(Array.isArray(result[3])).toBe(true);

        // Type guard to check if unassigned is an array
        if (Array.isArray(unassigned)) {
            expect(unassigned).toHaveLength(1);
            const contentElement = unassigned[0] as ReactElement<any, typeof Content>;
            expect(contentElement.type).toBe(Content);
        }
    });

    it('should handle missing slot components', () => {
        const children = [<Content key="content" />, <Footer key="footer" />];

        const result = getSlotsByComponentType(children, [Header, Footer]);
        const [header, footer, unassigned] = result;

        expect(header).toBeNull();
        expect(footer).toBeDefined();
        expect(Array.isArray(result[2])).toBe(true);

        if (Array.isArray(unassigned)) {
            expect(unassigned).toHaveLength(1);
            const contentElement = unassigned[0] as ReactElement<any, typeof Content>;
            expect(contentElement.type).toBe(Content);
        }
    });

    it('should handle empty children', () => {
        const result = getSlotsByComponentType([], [Header, Footer]);
        const [header, footer, unassigned] = result;

        expect(header).toBeNull();
        expect(footer).toBeNull();
        expect(Array.isArray(result[2])).toBe(true);

        if (Array.isArray(unassigned)) {
            expect(unassigned).toHaveLength(0);
        }
    });

    it('should handle null and undefined children', () => {
        const children = [<Header key="header" />, null, undefined, <Footer key="footer" />];

        const result = getSlotsByComponentType(children, [Header, Footer]);
        const [header, footer, unassigned] = result;

        expect(header).toBeDefined();
        expect(footer).toBeDefined();
        expect(Array.isArray(result[2])).toBe(true);

        if (Array.isArray(unassigned)) {
            expect(unassigned).toHaveLength(0);
        }
    });

    it('should handle multiple unmatched components', () => {
        const children = [
            <Header key="header" />,
            <UnmatchedComponent key="unmatched1" />,
            <Content key="content" />,
            <UnmatchedComponent key="unmatched2" />,
        ];

        const result = getSlotsByComponentType(children, [Header, Footer]);
        const [header, footer, unassigned] = result;

        expect(header).toBeDefined();
        expect(footer).toBeNull();
        expect(Array.isArray(result[2])).toBe(true);

        if (Array.isArray(unassigned)) {
            expect(unassigned).toHaveLength(3);

            expect(unassigned.some((child) => isValidElement(child) && child.type === UnmatchedComponent)).toBe(true);

            expect(unassigned.some((child) => isValidElement(child) && child.type === Content)).toBe(true);
        }
    });

    it('should maintain the order of unassigned children', () => {
        const children = [
            <Content key="content1" />,
            <UnmatchedComponent key="unmatched" />,
            <Content key="content2" />,
        ];

        const result = getSlotsByComponentType(children, [Header, Footer]);
        const [_header, _footer, unassigned] = result;

        if (Array.isArray(unassigned)) {
            expect(unassigned).toHaveLength(3);
            const elements = unassigned

                .map((child) => (isValidElement(child) ? child : null))
                .filter((child): child is ReactElement => child !== null);

            expect(elements[0].type).toBe(Content);
            expect(elements[1].type).toBe(UnmatchedComponent);
            expect(elements[2].type).toBe(Content);
        }
    });

    it('should handle components with props', () => {
        const HeaderWithProps = ({ title }: { title: string }) => <header>{title}</header>;
        const children = [<HeaderWithProps key="header" title="Test" />, <Footer key="footer" />];

        const result = getSlotsByComponentType(children, [HeaderWithProps, Footer]);
        const [header, footer, unassigned] = result;

        expect(header).toBeDefined();
        if (isValidElement(header)) {
            expect(header.props.title).toBe('Test');
        }
        expect(footer).toBeDefined();

        if (Array.isArray(unassigned)) {
            expect(unassigned).toHaveLength(0);
        }
    });
});
