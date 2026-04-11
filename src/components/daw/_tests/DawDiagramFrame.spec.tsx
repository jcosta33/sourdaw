import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DawDiagramFrame } from '../DawDiagramFrame';

describe('DawDiagramFrame', () => {
    it('should render header viewport and footer', () => {
        render(
            <DawDiagramFrame title="Graph" actions={<span data-testid="a">a</span>} footer={<span>foot</span>}>
                body
            </DawDiagramFrame>
        );
        expect(screen.getByText('Graph')).toBeInTheDocument();
        expect(screen.getByTestId('a')).toBeInTheDocument();
        expect(screen.getByText('body')).toBeInTheDocument();
        expect(screen.getByText('foot')).toBeInTheDocument();
    });
});
