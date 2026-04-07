import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CollaborationBlock } from './CollaborationBlock';

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
