/**
 * Section navigation tabs for the center inspector.
 * Instead of showing all controls at once, the user picks which section to focus on.
 * This is the "selection drives detail" model from the UX spec.
 */
import { type ReactElement } from 'react';

import { DawTabStrip, type DawTabStripItem } from '#/components/daw/DawTabStrip';

export type FermenterSection = 'osc' | 'filter' | 'env' | 'mod' | 'fx';

export const FERMENTER_SECTION_PANEL_ID = 'fermenter-section-panel';
export const FERMENTER_SECTION_TAB_ID_PREFIX = 'fermenter-section';

const SECTIONS: readonly DawTabStripItem<FermenterSection>[] = [
    { id: 'osc', label: 'Oscillator', activeClassName: 'bg-[var(--color-accent-lavender)] text-white' },
    { id: 'filter', label: 'Filter', activeClassName: 'bg-[var(--color-accent-cyan)] text-white' },
    { id: 'env', label: 'Envelopes', activeClassName: 'bg-[var(--color-accent-mint)] text-white' },
    { id: 'mod', label: 'Modulation', activeClassName: 'bg-[var(--color-accent-peach)] text-white' },
    { id: 'fx', label: 'Effects', activeClassName: 'bg-[var(--color-accent-lavender)] text-white' },
];

type SectionNavProps = {
    active: FermenterSection;
    onChange: (section: FermenterSection) => void;
};

export const SectionNav = ({ active, onChange }: SectionNavProps): ReactElement => (
    <DawTabStrip
        label="Fermenter sections"
        idPrefix={FERMENTER_SECTION_TAB_ID_PREFIX}
        panelId={FERMENTER_SECTION_PANEL_ID}
        items={SECTIONS}
        activeId={active}
        onChange={onChange}
        className="px-1"
        tabClassName="rounded px-2 py-0.5 text-[9px] font-medium text-muted-foreground hover:text-foreground"
    />
);
