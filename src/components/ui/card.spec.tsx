import { createRef, type RefObject } from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from './card';

describe('Card', () => {
    it('should render Card with className merge', () => {
        const { container } = render(<Card data-testid="card" className="extra" />);
        expect(container.firstChild).toHaveClass('extra');
        expect(container.firstChild).toHaveClass('daw-panel-surface');
    });

    it('should forward refs on all card parts', () => {
        const cardRef: RefObject<HTMLDivElement | null> = createRef();
        const headerRef: RefObject<HTMLDivElement | null> = createRef();
        const titleRef: RefObject<HTMLHeadingElement | null> = createRef();
        const descRef: RefObject<HTMLParagraphElement | null> = createRef();
        const contentRef: RefObject<HTMLDivElement | null> = createRef();
        const footerRef: RefObject<HTMLDivElement | null> = createRef();
        render(
            <Card ref={cardRef}>
                <CardHeader ref={headerRef}>
                    <CardTitle ref={titleRef}>T</CardTitle>
                    <CardDescription ref={descRef}>D</CardDescription>
                </CardHeader>
                <CardContent ref={contentRef}>B</CardContent>
                <CardFooter ref={footerRef}>F</CardFooter>
            </Card>
        );
        expect(cardRef.current).toBeInstanceOf(HTMLDivElement);
        expect(headerRef.current).toBeInstanceOf(HTMLDivElement);
        expect(titleRef.current).toBeInstanceOf(HTMLHeadingElement);
        expect(descRef.current).toBeInstanceOf(HTMLParagraphElement);
        expect(contentRef.current).toBeInstanceOf(HTMLDivElement);
        expect(footerRef.current).toBeInstanceOf(HTMLDivElement);
    });

    it('should render CardTitle as a heading', () => {
        render(
            <Card>
                <CardHeader>
                    <CardTitle>Title text</CardTitle>
                    <CardDescription>Desc</CardDescription>
                </CardHeader>
                <CardContent>Body</CardContent>
                <CardFooter>Foot</CardFooter>
            </Card>
        );
        expect(screen.getByRole('heading', { level: 3, name: 'Title text' })).toBeInTheDocument();
        expect(screen.getByText('Desc')).toBeInTheDocument();
        expect(screen.getByText('Body')).toBeInTheDocument();
        expect(screen.getByText('Foot')).toBeInTheDocument();
    });
});
