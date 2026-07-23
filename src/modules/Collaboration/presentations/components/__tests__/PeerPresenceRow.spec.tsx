import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

import { PeerPresenceRow } from '../PeerPresenceRow';

describe('PeerPresenceRow', () => {
    it('should render', () => {
        render(<PeerPresenceRow name="Ada" color="#7fc8a0" isConnected isHost={false} />);
        expect(screen.getByText('Ada')).toBeInTheDocument();
        expect(screen.getByText(/live/i)).toBeInTheDocument();
    });

    it('shows a host badge when isHost is true', () => {
        render(<PeerPresenceRow name="Ada" color="#7fc8a0" isConnected isHost />);
        expect(screen.getByText('host')).toBeInTheDocument();
    });

    it('omits the host badge when isHost is false', () => {
        render(<PeerPresenceRow name="Ada" color="#7fc8a0" isConnected isHost={false} />);
        expect(screen.queryByText('host')).not.toBeInTheDocument();
    });

    it('shows an idle indicator when not connected', () => {
        render(<PeerPresenceRow name="Bob" color="#7fc8a0" isConnected={false} isHost={false} />);
        expect(screen.getByText(/idle/i)).toBeInTheDocument();
    });

    it('shows both the idle indicator and the host badge together', () => {
        render(<PeerPresenceRow name="Cy" color="#7fc8a0" isConnected={false} isHost />);
        expect(screen.getByText(/idle/i)).toBeInTheDocument();
        expect(screen.getByText('host')).toBeInTheDocument();
    });
});
