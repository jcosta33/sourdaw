/**
 * Section navigation tabs for the center inspector.
 * Instead of showing all controls at once, the user picks which section to focus on.
 * This is the "selection drives detail" model from the UX spec.
 */
import { type ReactElement } from 'react';

import { Row } from '#/components/layout';
import { Button } from '#/components/ui/button';

export type FermenterSection = 'osc' | 'filter' | 'env' | 'mod' | 'fx';

const SECTIONS: Array<{ id: FermenterSection; label: string; color: string }> = [
    { id: 'osc', label: 'Oscillator', color: 'var(--color-accent-lavender)' },
    { id: 'filter', label: 'Filter', color: 'var(--color-accent-cyan)' },
    { id: 'env', label: 'Envelopes', color: 'var(--color-accent-mint)' },
    { id: 'mod', label: 'Modulation', color: 'var(--color-accent-peach)' },
    { id: 'fx', label: 'Effects', color: 'var(--color-accent-lavender)' },
];

type SectionNavProps = {
    active: FermenterSection;
    onChange: (section: FermenterSection) => void;
};

export const SectionNav = ({ active, onChange }: SectionNavProps): ReactElement => (
    <Row align="stretch" gap={0.5} className="px-1">
        {SECTIONS.map(({ id, label, color }) => (
            <Button
                variant="bare"
                size="bare"
                key={id}
                type="button"
                className={`px-2 py-0.5 rounded text-[9px] font-medium transition-all ${
                    active === id ? 'text-white' : 'text-muted-foreground hover:text-foreground'
                }`}
                style={active === id ? { backgroundColor: color } : undefined}
                onClick={() => onChange(id)}
            >
                {label}
            </Button>
        ))}
    </Row>
);
