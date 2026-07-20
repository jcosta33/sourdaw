import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { useStore } from '#/infra/store/useStore';
import { type CvOutputChannel } from '#/modules/CvGate/stores';

import { CvOutputStatusBadge } from '../CvOutputStatusBadge';

vi.mock('#/infra/store/useStore', () => ({
    useStore: vi.fn(),
}));

const useStoreMock = vi.mocked(useStore);

const buildOutput = (index: number): CvOutputChannel => ({
    id: `cv-${index}`,
    name: `Output ${index}`,
    outputChannel: index,
    type: 'cv-pitch',
    minVoltage: -2,
    maxVoltage: 8,
    value: 0,
    active: true,
});

const mockCvGateOutputs = (count: number): void => {
    const outputs = Array.from({ length: count }, (_value, index) => buildOutput(index));
    useStoreMock.mockReturnValue({ outputs });
};

describe('CvOutputStatusBadge', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renders nothing when no CV/Gate outputs are configured', () => {
        mockCvGateOutputs(0);

        const { container } = render(<CvOutputStatusBadge />);

        expect(container).toBeEmptyDOMElement();
    });

    it('reflects a single configured output with a singular aria description', () => {
        mockCvGateOutputs(1);

        render(<CvOutputStatusBadge />);

        const badge = screen.getByLabelText('1 CV/Gate output configured');
        expect(badge).toHaveTextContent('1 CV/Gate');
    });

    it('reflects multiple configured outputs with a pluralised count and aria description', () => {
        mockCvGateOutputs(3);

        render(<CvOutputStatusBadge />);

        const badge = screen.getByLabelText('3 CV/Gate outputs configured');
        expect(badge).toHaveTextContent('3 CV/Gate');
    });
});
