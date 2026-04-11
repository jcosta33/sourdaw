import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MixerSection } from '../MixerSection';

describe('MixerSection', () => {
    it('should render label and body', () => {
        render(
            <MixerSection label="Dynamics">
                <div>Content</div>
            </MixerSection>
        );
        expect(screen.getByText('Dynamics')).toBeInTheDocument();
        expect(screen.getByText('Content')).toBeInTheDocument();
    });
});
