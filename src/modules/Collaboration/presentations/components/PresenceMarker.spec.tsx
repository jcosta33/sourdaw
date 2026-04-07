import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PresenceMarker } from './PresenceMarker';

describe('PresenceMarker', () => {
    it('should render', () => {
        render(<PresenceMarker name="Cue" color="#f00" left={4} variant="playhead" />);
        expect(screen.getByText('Cue')).toBeInTheDocument();
    });
});
