import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('#/infra/store/useStore', () => ({
    useStore: vi.fn(),
}));

vi.mock('#/modules/Project/useCases', () => ({
    importSclFile: vi.fn(),
}));

import { useStore } from '#/infra/store/useStore';
import { importSclFile } from '#/modules/Project/useCases';

import { ProjectTab } from '../ProjectTab';

const mockedUseStore = vi.mocked(useStore);
const mockedImportScl = vi.mocked(importSclFile);

function setProject(project: Record<string, unknown> | null): void {
    mockedUseStore.mockReturnValue(project);
}

beforeEach(() => {
    vi.clearAllMocks();
});

describe('ProjectTab — empty state', () => {
    it('renders an empty div when project is null', () => {
        setProject(null);
        const { container } = render(<ProjectTab />);
        expect(container.firstChild).toBeEmptyDOMElement();
    });
});

describe('ProjectTab — project meta display', () => {
    it('displays the project name', () => {
        setProject({ name: 'My Song', createdAt: 0, keyRoot: 0, scaleName: 'major', tuning: { name: '12-TET' } });
        render(<ProjectTab />);
        expect(screen.getByText('My Song')).toBeInTheDocument();
    });

    it('displays the tuning name', () => {
        setProject({ name: 'X', createdAt: 0, keyRoot: 0, scaleName: 'major', tuning: { name: 'Equal Temperament' } });
        render(<ProjectTab />);
        expect(screen.getByText('Equal Temperament')).toBeInTheDocument();
    });

    it('displays the scale name', () => {
        setProject({ name: 'X', createdAt: 0, keyRoot: 0, scaleName: 'pentatonicMinor', tuning: { name: 'ET' } });
        render(<ProjectTab />);
        expect(screen.getByText('pentatonicMinor')).toBeInTheDocument();
    });

    it('displays the key name from keyRoot (0 → C)', () => {
        setProject({ name: 'X', createdAt: 0, keyRoot: 0, scaleName: 'major', tuning: { name: 'ET' } });
        render(<ProjectTab />);
        expect(screen.getByText('C')).toBeInTheDocument();
    });

    it('displays the key name from keyRoot (5 → F)', () => {
        setProject({ name: 'X', createdAt: 0, keyRoot: 5, scaleName: 'major', tuning: { name: 'ET' } });
        render(<ProjectTab />);
        expect(screen.getByText('F')).toBeInTheDocument();
    });

    it('wraps keyRoot > 11 via modulo (12 → C)', () => {
        setProject({ name: 'X', createdAt: 0, keyRoot: 12, scaleName: 'major', tuning: { name: 'ET' } });
        render(<ProjectTab />);
        expect(screen.getByText('C')).toBeInTheDocument();
    });

    it('wraps keyRoot to correct name (11 → B)', () => {
        setProject({ name: 'X', createdAt: 0, keyRoot: 11, scaleName: 'major', tuning: { name: 'ET' } });
        render(<ProjectTab />);
        expect(screen.getByText('B')).toBeInTheDocument();
    });
});

describe('ProjectTab — Import Scala button', () => {
    it('renders the Import Scala button', () => {
        setProject({ name: 'X', createdAt: 0, keyRoot: 0, scaleName: 'major', tuning: { name: 'ET' } });
        render(<ProjectTab />);
        expect(screen.getByRole('button', { name: /import scala/i })).toBeInTheDocument();
    });

    it('calls importSclFile when clicked', () => {
        setProject({ name: 'X', createdAt: 0, keyRoot: 0, scaleName: 'major', tuning: { name: 'ET' } });
        render(<ProjectTab />);
        fireEvent.click(screen.getByRole('button', { name: /import scala/i }));
        expect(mockedImportScl).toHaveBeenCalledTimes(1);
    });
});
