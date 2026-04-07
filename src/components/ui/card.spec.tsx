import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from './card';

describe('Card', () => {
    it('should render Card with className merge', () => {
        const { container } = render(<Card data-testid="card" className="extra" />);
        expect(container.firstChild).toHaveClass('extra');
        expect(container.firstChild).toHaveClass('daw-panel-surface');
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
