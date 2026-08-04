import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

import {
    levelColor,
    levelTextColor,
    severityIcon,
    BAND_LABELS,
    FrequencyBar,
    OverallLevel,
    FrequencyBalance,
    TrackLevelsList,
    IssuesList,
    SuggestionsList,
} from '../MixAnalysisSections';

describe('levelColor — threshold branches', () => {
    it('returns danger for db > -0.5', () => {
        expect(levelColor(0)).toContain('danger');
    });
    it('returns warning for -3 < db <= -0.5', () => {
        expect(levelColor(-1)).toContain('warning');
    });
    it('returns success for db <= -3', () => {
        expect(levelColor(-6)).toContain('success');
    });
});

describe('levelTextColor — threshold branches', () => {
    it('returns danger for db > -0.5', () => {
        expect(levelTextColor(0)).toContain('danger');
    });
    it('returns warning for -3 < db <= -0.5', () => {
        expect(levelTextColor(-2)).toContain('warning');
    });
    it('returns success for db <= -3', () => {
        expect(levelTextColor(-10)).toContain('success');
    });
});

describe('severityIcon — switch branches', () => {
    it('renders an element for critical', () => {
        const result = severityIcon('critical');
        expect(result).toBeTruthy();
    });
    it('renders an element for warning', () => {
        const result = severityIcon('warning');
        expect(result).toBeTruthy();
    });
    it('renders an element for info', () => {
        const result = severityIcon('info');
        expect(result).toBeTruthy();
    });
    it('renders an element for unknown severity (default)', () => {
        const result = severityIcon('unknown' as never);
        expect(result).toBeTruthy();
    });
});

describe('BAND_LABELS — structure', () => {
    it('has 6 bands', () => {
        expect(BAND_LABELS).toHaveLength(6);
    });
    it('includes Sub, Bass, Mid, High', () => {
        const labels = BAND_LABELS.map((b) => b.label);
        expect(labels).toContain('Sub');
        expect(labels).toContain('Bass');
        expect(labels).toContain('Mid');
        expect(labels).toContain('High');
    });
});

describe('FrequencyBar — computed text', () => {
    it('renders formatted dB value', () => {
        render(<FrequencyBar label="Sub" range="20–60 Hz" db={-12.5} />);
        expect(screen.getByText('-12.5 dB')).toBeInTheDocument();
    });
});

describe('OverallLevel — display', () => {
    it('renders peak and RMS values', () => {
        render(<OverallLevel level={{ peakDb: -1.5, rmsDb: -12 }} />);
        expect(screen.getByText('-1.5 dB')).toBeInTheDocument();
        expect(screen.getByText('-12.0 dB')).toBeInTheDocument();
    });
});

describe('FrequencyBalance — band rendering', () => {
    it('renders all 6 band labels', () => {
        render(<FrequencyBalance bands={{ sub: -20, bass: -15, lowMid: -10, mid: -8, highMid: -12, high: -18 }} />);
        expect(screen.getByText('Sub')).toBeInTheDocument();
        expect(screen.getByText('Bass')).toBeInTheDocument();
        expect(screen.getByText('High')).toBeInTheDocument();
    });
});

describe('TrackLevelsList — track rendering', () => {
    it('shows "No tracks to analyze." when empty', () => {
        render(<TrackLevelsList trackLevels={[]} />);
        expect(screen.getByText('No tracks to analyze.')).toBeInTheDocument();
    });

    it('renders track name and peak dB', () => {
        render(
            <TrackLevelsList
                trackLevels={[
                    {
                        trackId: 't1',
                        trackName: 'Kick',
                        peakDb: -3.5,
                        rmsDb: -15,
                        isMuted: false,
                        isSoloed: false,
                        isClipping: false,
                    },
                ]}
            />
        );
        expect(screen.getByText('Kick')).toBeInTheDocument();
        expect(screen.getByText('-3.5 dB')).toBeInTheDocument();
    });

    it('shows M badge for muted track', () => {
        render(
            <TrackLevelsList
                trackLevels={[
                    {
                        trackId: 't1',
                        trackName: 'Kick',
                        peakDb: -3,
                        rmsDb: -15,
                        isMuted: true,
                        isSoloed: false,
                        isClipping: false,
                    },
                ]}
            />
        );
        expect(screen.getByText('M')).toBeInTheDocument();
    });

    it('shows S badge for soloed track', () => {
        render(
            <TrackLevelsList
                trackLevels={[
                    {
                        trackId: 't1',
                        trackName: 'Kick',
                        peakDb: -3,
                        rmsDb: -15,
                        isMuted: false,
                        isSoloed: true,
                        isClipping: false,
                    },
                ]}
            />
        );
        expect(screen.getByText('S')).toBeInTheDocument();
    });
});

describe('IssuesList — empty vs populated', () => {
    it('returns null for empty issues', () => {
        const { container } = render(<IssuesList issues={[]} />);
        expect(container.firstChild).toBeNull();
    });

    it('renders issue messages', () => {
        render(<IssuesList issues={[{ severity: 'critical', category: 'level', message: 'Master is clipping!' }]} />);
        expect(screen.getByText('Master is clipping!')).toBeInTheDocument();
    });

    it('pluralizes detail for multiple issues', () => {
        render(
            <IssuesList
                issues={[
                    { severity: 'warning', category: 'level', message: 'A' },
                    { severity: 'warning', category: 'level', message: 'B' },
                ]}
            />
        );
        expect(screen.getByText(/2 items need attention/)).toBeInTheDocument();
    });
});

describe('SuggestionsList — empty vs populated', () => {
    it('returns null for empty suggestions', () => {
        const { container } = render(<SuggestionsList suggestions={[]} />);
        expect(container.firstChild).toBeNull();
    });

    it('renders suggestion text', () => {
        render(<SuggestionsList suggestions={['Reduce master gain by 2 dB']} />);
        expect(screen.getByText('Reduce master gain by 2 dB')).toBeInTheDocument();
    });
});
