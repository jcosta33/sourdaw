import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

import { CollaborationBlock } from '../CollaborationBlock';

describe('CollaborationBlock', () => {
    it('should render', () => {
        render(
            <CollaborationBlock title="Session" description="Test block">
                <span>child</span>
            </CollaborationBlock>
        );
        expect(screen.getByText('Session')).toBeInTheDocument();
        expect(screen.getByText('child')).toBeInTheDocument();
    });
});

describe('CollaborationBlock — header conditional rendering', () => {
    it('renders the title and description when both are provided', () => {
        render(
            <CollaborationBlock title="My Title" description="My description">
                <span>content</span>
            </CollaborationBlock>
        );
        expect(screen.getByText('My Title')).toBeTruthy();
        expect(screen.getByText('My description')).toBeTruthy();
    });

    it('renders only the title when description is omitted', () => {
        render(
            <CollaborationBlock title="Solo Title">
                <span>content</span>
            </CollaborationBlock>
        );
        expect(screen.getByText('Solo Title')).toBeTruthy();
    });

    it('omits the header block entirely when neither title nor description is provided', () => {
        const { container } = render(
            <CollaborationBlock>
                <span>content</span>
            </CollaborationBlock>
        );
        expect(screen.getByText('content')).toBeTruthy();
        // No DawEyebrowLabel or description paragraph rendered
        expect(container.querySelector('p')).toBeNull();
    });
});

describe('CollaborationBlock — children pass-through', () => {
    it('renders nested children content', () => {
        render(
            <CollaborationBlock>
                <div data-testid="custom-content">Custom</div>
            </CollaborationBlock>
        );
        expect(screen.getByTestId('custom-content')).toBeTruthy();
        expect(screen.getByText('Custom')).toBeTruthy();
    });
});
