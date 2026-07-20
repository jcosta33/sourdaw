import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { useStore } from '#/infra/store/useStore';

import { MonitorStatusBadge } from '../MonitorStatusBadge';

vi.mock('#/infra/store/useStore', () => ({
    useStore: vi.fn(),
}));

const useStoreMock = vi.mocked(useStore);

type ControlRoomFlags = {
    monoActive: boolean;
    dimActive: boolean;
};

const mockControlRoomState = ({ monoActive, dimActive }: ControlRoomFlags): void => {
    useStoreMock.mockReturnValue({ monoActive, dimActive });
};

describe('MonitorStatusBadge', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renders nothing when neither mono nor dim monitoring is active', () => {
        mockControlRoomState({ monoActive: false, dimActive: false });

        const { container } = render(<MonitorStatusBadge />);

        expect(container).toBeEmptyDOMElement();
    });

    it('reflects mono-only monitoring with a Mono label and aria description', () => {
        mockControlRoomState({ monoActive: true, dimActive: false });

        render(<MonitorStatusBadge />);

        const badge = screen.getByLabelText('Monitoring: Mono active');
        expect(badge).toHaveTextContent('Mono');
        expect(badge).not.toHaveTextContent('Dim');
    });

    it('reflects dim-only monitoring with a Dim label and aria description', () => {
        mockControlRoomState({ monoActive: false, dimActive: true });

        render(<MonitorStatusBadge />);

        const badge = screen.getByLabelText('Monitoring: Dim active');
        expect(badge).toHaveTextContent('Dim');
        expect(badge).not.toHaveTextContent('Mono');
    });

    it('reflects both mono and dim active with a combined label', () => {
        mockControlRoomState({ monoActive: true, dimActive: true });

        render(<MonitorStatusBadge />);

        const badge = screen.getByLabelText('Monitoring: Mono · Dim active');
        expect(badge).toHaveTextContent('Mono · Dim');
    });
});
