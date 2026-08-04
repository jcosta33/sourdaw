import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { GenreGrid, MoodGrid, InstrumentGrid } from '../GenerativeParamGrids';

beforeEach(() => {
    vi.clearAllMocks();
});

describe('GenreGrid — option rendering', () => {
    it('renders all 5 genre options', () => {
        render(<GenreGrid value="" onChange={vi.fn()} />);
        expect(screen.getByText('Lo-Fi')).toBeInTheDocument();
        expect(screen.getByText('EDM / House')).toBeInTheDocument();
        expect(screen.getByText('Cinematic')).toBeInTheDocument();
        expect(screen.getByText('Synthwave')).toBeInTheDocument();
        expect(screen.getByText('Rock')).toBeInTheDocument();
    });
});

describe('GenreGrid — toggle behavior', () => {
    it('calls onChange with the option id when an unselected option is clicked', () => {
        const onChange = vi.fn();
        render(<GenreGrid value="" onChange={onChange} />);
        fireEvent.click(screen.getByText('Lo-Fi'));
        expect(onChange).toHaveBeenCalledWith('Lo-Fi Hip Hop');
    });

    it('calls onChange with empty string when an already-selected option is clicked (toggle off)', () => {
        const onChange = vi.fn();
        render(<GenreGrid value="Lo-Fi Hip Hop" onChange={onChange} />);
        fireEvent.click(screen.getByText('Lo-Fi'));
        expect(onChange).toHaveBeenCalledWith('');
    });
});

describe('MoodGrid — option rendering', () => {
    it('renders all 5 mood options', () => {
        render(<MoodGrid value="" onChange={vi.fn()} />);
        expect(screen.getByText('Chill')).toBeInTheDocument();
        expect(screen.getByText('Aggressive')).toBeInTheDocument();
        expect(screen.getByText('Upbeat')).toBeInTheDocument();
        expect(screen.getByText('Melancholy')).toBeInTheDocument();
        expect(screen.getByText('Epic')).toBeInTheDocument();
    });
});

describe('MoodGrid — toggle behavior', () => {
    it('calls onChange with mood id when clicked', () => {
        const onChange = vi.fn();
        render(<MoodGrid value="" onChange={onChange} />);
        fireEvent.click(screen.getByText('Chill'));
        expect(onChange).toHaveBeenCalledWith('Chill / Relaxed');
    });

    it('toggles off when already selected', () => {
        const onChange = vi.fn();
        render(<MoodGrid value="Chill / Relaxed" onChange={onChange} />);
        fireEvent.click(screen.getByText('Chill'));
        expect(onChange).toHaveBeenCalledWith('');
    });
});

describe('InstrumentGrid — option rendering', () => {
    it('renders all 5 instrument options', () => {
        render(<InstrumentGrid value="" onChange={vi.fn()} />);
        expect(screen.getByText('Acoustic Piano')).toBeInTheDocument();
        expect(screen.getByText('Analog Synth')).toBeInTheDocument();
        expect(screen.getByText('Drum Kit')).toBeInTheDocument();
        expect(screen.getByText('Electric Bass')).toBeInTheDocument();
        expect(screen.getByText('Strings')).toBeInTheDocument();
    });
});

describe('InstrumentGrid — toggle behavior', () => {
    it('calls onChange with instrument id when clicked', () => {
        const onChange = vi.fn();
        render(<InstrumentGrid value="" onChange={onChange} />);
        fireEvent.click(screen.getByText('Drum Kit'));
        expect(onChange).toHaveBeenCalledWith('Drum Kit');
    });

    it('toggles off when already selected', () => {
        const onChange = vi.fn();
        render(<InstrumentGrid value="Drum Kit" onChange={onChange} />);
        fireEvent.click(screen.getByText('Drum Kit'));
        expect(onChange).toHaveBeenCalledWith('');
    });
});
