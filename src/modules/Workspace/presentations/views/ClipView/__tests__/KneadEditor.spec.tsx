import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { KneadEditor } from '../KneadEditor';

vi.mock('#/components/ui/button', () => ({
    Button: ({
        children,
        onClick,
        variant,
        size,
    }: {
        children: React.ReactNode;
        onClick?: () => void;
        variant?: string;
        size?: string;
    }) => (
        <button type="button" onClick={onClick} data-variant={variant} data-size={size}>
            {children}
        </button>
    ),
}));

vi.mock('#/components/ui/slider', () => ({
    Slider: ({
        value,
        onValueChange,
        min,
        max,
        step,
        className,
    }: {
        value: number[];
        onValueChange: (v: number[]) => void;
        min?: number;
        max?: number;
        step?: number;
        className?: string;
    }) => (
        <input
            type="range"
            value={value[0]}
            min={min}
            max={max}
            step={step}
            className={className}
            onChange={(e) => onValueChange([Number(e.target.value)])}
        />
    ),
}));

vi.mock('#/components/daw/DawCompactCheckbox', () => ({
    DawCompactCheckbox: ({
        checked,
        onChange,
        id,
        className,
    }: {
        checked: boolean;
        onChange: (e: { target: { checked: boolean } }) => void;
        id?: string;
        className?: string;
    }) => (
        <input
            type="checkbox"
            checked={checked}
            onChange={(e) => onChange({ target: { checked: e.target.checked } })}
            id={id}
            className={className}
        />
    ),
}));

vi.mock('#/modules/Knead/stores', () => ({
    kneadStore: { value: { clips: {} } },
}));

vi.mock('#/modules/Knead/useCases', () => ({
    updateClipKneadState: vi.fn(),
}));

vi.mock('#/infra/store/useStore', () => ({
    useStore: vi.fn((_store: unknown, defaultValue: unknown) => defaultValue ?? {}),
}));

vi.mock('../../../hooks/useTracks', () => ({
    useTracks: vi.fn(() => ({ tracks: [] })),
}));

vi.mock('#/modules/Arrangement/useCases/device/addDevice', () => ({
    addDevice: vi.fn(),
}));

vi.mock('#/modules/Knead/useCases/dspAnalysis', () => ({
    ingestDspAnalysis: vi.fn(),
}));

describe('KneadEditor', () => {
    const defaultProps = {
        trackId: 'track-1',
        clipId: 'clip-1',
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render without crashing', () => {
        render(<KneadEditor {...defaultProps} />);
        expect(screen.getByText('Pitch Correction Disabled')).toBeInTheDocument();
    });

    it('should render enable pitch editor button when no knead device', () => {
        render(<KneadEditor {...defaultProps} />);
        expect(screen.getByText('Enable Pitch Editor')).toBeInTheDocument();
    });

    it('should render canvas element', () => {
        render(<KneadEditor {...defaultProps} />);
        expect(document.querySelector('canvas')).toBeInTheDocument();
    });

    it('should display disabled state icon', () => {
        render(<KneadEditor {...defaultProps} />);
        expect(screen.getByText('Pitch Correction Disabled')).toBeInTheDocument();
    });

    it('should show description text when disabled', () => {
        render(<KneadEditor {...defaultProps} />);
        expect(screen.getByText(/Enable Knead on this track/)).toBeInTheDocument();
    });
});
