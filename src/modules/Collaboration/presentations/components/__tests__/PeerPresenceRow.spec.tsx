import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

import { PeerPresenceRow } from '../PeerPresenceRow';

describe('PeerPresenceRow', () => {
    it('should render', () => {
        render(<PeerPresenceRow name="Ada" color="#7fc8a0" isConnected isHost={false} syncHealth="converging" />);
        expect(screen.getByText('Ada')).toBeInTheDocument();
        expect(screen.getByText(/live/i)).toBeInTheDocument();
    });

    it('shows a host badge when isHost is true', () => {
        render(<PeerPresenceRow name="Ada" color="#7fc8a0" isConnected isHost syncHealth="converging" />);
        expect(screen.getByText('host')).toBeInTheDocument();
    });

    it('omits the host badge when isHost is false', () => {
        render(<PeerPresenceRow name="Ada" color="#7fc8a0" isConnected isHost={false} syncHealth="converging" />);
        expect(screen.queryByText('host')).not.toBeInTheDocument();
    });

    it('shows an idle indicator when not connected', () => {
        render(
            <PeerPresenceRow name="Bob" color="#7fc8a0" isConnected={false} isHost={false} syncHealth="converging" />
        );
        expect(screen.getByText(/idle/i)).toBeInTheDocument();
    });

    it('shows both the idle indicator and the host badge together', () => {
        render(<PeerPresenceRow name="Cy" color="#7fc8a0" isConnected={false} isHost syncHealth="converging" />);
        expect(screen.getByText(/idle/i)).toBeInTheDocument();
        expect(screen.getByText('host')).toBeInTheDocument();
    });

    it('labels a connected diverged peer distinctly from a live peer', () => {
        render(<PeerPresenceRow name="Dee" color="#7fc8a0" isConnected isHost={false} syncHealth="diverged" />);

        expect(screen.getByText(/diverged/i)).toBeInTheDocument();
        expect(screen.queryByText(/^live$/i)).not.toBeInTheDocument();
    });
});
