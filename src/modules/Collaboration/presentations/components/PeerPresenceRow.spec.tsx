import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PeerPresenceRow } from './PeerPresenceRow';

describe('PeerPresenceRow', () => {
    it('should render', () => {
        render(
            <PeerPresenceRow name="Ada" color="#7fc8a0" isConnected isHost={false} />
        );
        expect(screen.getByText('Ada')).toBeInTheDocument();
        expect(screen.getByText(/live/i)).toBeInTheDocument();
    });
});
