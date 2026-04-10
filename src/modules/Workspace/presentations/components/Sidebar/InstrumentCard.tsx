import { type ReactElement } from 'react';
import { type LucideIcon } from 'lucide-react';
import { DawChooserCard } from '#/components/daw/DawChooserCard';

type InstrumentCardProps = {
    icon: LucideIcon;
    label: string;
    badge: string;
    description: string;
    onClick: () => void;
    /** Pre-composed Tailwind classes for accent theming. */
    theme: InstrumentCardTheme;
};

type InstrumentCardTheme = {
    button: string;
    iconBox: string;
    iconColor: string;
    badgeColor: string;
    glow: string;
};

export const FERMENTER_THEME: InstrumentCardTheme = {
    button: 'border-[var(--color-accent-sage)]/30 bg-gradient-to-br from-[var(--color-accent-sage)]/10 via-surface-raised to-[var(--color-accent-sage)]/5 hover:border-[var(--color-accent-sage)]/50 hover:from-[var(--color-accent-sage)]/15',
    iconBox: 'bg-[var(--color-accent-sage)]/20 border-[var(--color-accent-sage)]/20 shadow-[0_0_12px_rgba(138,168,138,0.15)]',
    iconColor: 'text-[var(--color-accent-sage)]',
    badgeColor: 'bg-[var(--color-accent-sage)]/20 text-[var(--color-accent-sage)]',
    glow: 'bg-[var(--color-accent-sage)]/8',
};

export const TOASTER_THEME: InstrumentCardTheme = {
    button: 'border-[var(--color-accent-peach)]/30 bg-gradient-to-br from-[var(--color-accent-peach)]/10 via-surface-raised to-[var(--color-accent-peach)]/5 hover:border-[var(--color-accent-peach)]/50 hover:from-[var(--color-accent-peach)]/15',
    iconBox:
        'bg-[var(--color-accent-peach)]/20 border-[var(--color-accent-peach)]/20 shadow-[0_0_12px_rgba(201,160,122,0.15)]',
    iconColor: 'text-[var(--color-accent-peach)]',
    badgeColor: 'bg-[var(--color-accent-peach)]/20 text-[var(--color-accent-peach)]',
    glow: 'bg-[var(--color-accent-peach)]/8',
};

export const LEVAIN_THEME: InstrumentCardTheme = {
    button: 'border-[var(--color-accent-coral)]/30 bg-gradient-to-br from-[var(--color-accent-coral)]/10 via-surface-raised to-[var(--color-accent-coral)]/5 hover:border-[var(--color-accent-coral)]/50 hover:from-[var(--color-accent-coral)]/15',
    iconBox: 'bg-[var(--color-accent-coral)]/20 border-[var(--color-accent-coral)]/20 shadow-[0_0_12px_rgba(224,122,110,0.15)]',
    iconColor: 'text-[var(--color-accent-coral)]',
    badgeColor: 'bg-[var(--color-accent-coral)]/20 text-[var(--color-accent-coral)]',
    glow: 'bg-[var(--color-accent-coral)]/8',
};

export const PROOF_THEME: InstrumentCardTheme = {
    button: 'border-[var(--color-accent-cyan)]/30 bg-gradient-to-br from-[var(--color-accent-cyan)]/10 via-surface-raised to-[var(--color-accent-cyan)]/5 hover:border-[var(--color-accent-cyan)]/50 hover:from-[var(--color-accent-cyan)]/15',
    iconBox:
        'bg-[var(--color-accent-cyan)]/20 border-[var(--color-accent-cyan)]/20 shadow-[0_0_12px_rgba(127,184,196,0.15)]',
    iconColor: 'text-[var(--color-accent-cyan)]',
    badgeColor: 'bg-[var(--color-accent-cyan)]/20 text-[var(--color-accent-cyan)]',
    glow: 'bg-[var(--color-accent-cyan)]/8',
};

export const KNEAD_THEME: InstrumentCardTheme = {
    button: 'border-[var(--color-accent-pink)]/30 bg-gradient-to-br from-[var(--color-accent-pink)]/10 via-surface-raised to-[var(--color-accent-pink)]/5 hover:border-[var(--color-accent-pink)]/50 hover:from-[var(--color-accent-pink)]/15',
    iconBox:
        'bg-[var(--color-accent-pink)]/20 border-[var(--color-accent-pink)]/20 shadow-[0_0_12px_rgba(193,143,163,0.15)]',
    iconColor: 'text-[var(--color-accent-pink)]',
    badgeColor: 'bg-[var(--color-accent-pink)]/20 text-[var(--color-accent-pink)]',
    glow: 'bg-[var(--color-accent-pink)]/8',
};

export const SCORING_THEME: InstrumentCardTheme = {
    button: 'border-[var(--color-accent-indigo)]/30 bg-gradient-to-br from-[var(--color-accent-indigo)]/10 via-surface-raised to-[var(--color-accent-indigo)]/5 hover:border-[var(--color-accent-indigo)]/50 hover:from-[var(--color-accent-indigo)]/15',
    iconBox: 'bg-[var(--color-accent-indigo)]/20 border-[var(--color-accent-indigo)]/20 shadow-[0_0_12px_rgba(74,96,160,0.15)]',
    iconColor: 'text-[var(--color-accent-indigo)]',
    badgeColor: 'bg-[var(--color-accent-indigo)]/20 text-[var(--color-accent-indigo)]',
    glow: 'bg-[var(--color-accent-indigo)]/8',
};

export const DUTCH_OVEN_THEME: InstrumentCardTheme = {
    button: 'border-[var(--color-accent-amber)]/30 bg-gradient-to-br from-[var(--color-accent-amber)]/10 via-surface-raised to-[var(--color-accent-amber)]/5 hover:border-[var(--color-accent-amber)]/50 hover:from-[var(--color-accent-amber)]/15',
    iconBox: 'bg-[var(--color-accent-amber)]/20 border-[var(--color-accent-amber)]/20 shadow-[0_0_12px_rgba(196,170,95,0.15)]',
    iconColor: 'text-[var(--color-accent-amber)]',
    badgeColor: 'bg-[var(--color-accent-amber)]/20 text-[var(--color-accent-amber)]',
    glow: 'bg-[var(--color-accent-amber)]/8',
};

export const GLUTEN_THEME: InstrumentCardTheme = {
    button: 'border-[var(--color-accent-lavender)]/30 bg-gradient-to-br from-[var(--color-accent-lavender)]/10 via-surface-raised to-[var(--color-accent-lavender)]/5 hover:border-[var(--color-accent-lavender)]/50 hover:from-[var(--color-accent-lavender)]/15',
    iconBox:
        'bg-[var(--color-accent-lavender)]/20 border-[var(--color-accent-lavender)]/20 shadow-[0_0_12px_rgba(168,155,196,0.15)]',
    iconColor: 'text-[var(--color-accent-lavender)]',
    badgeColor: 'bg-[var(--color-accent-lavender)]/20 text-[var(--color-accent-lavender)]',
    glow: 'bg-[var(--color-accent-lavender)]/8',
};

export const BACTERIA_THEME: InstrumentCardTheme = {
    button: 'border-[var(--color-accent-mint-bright)]/30 bg-gradient-to-br from-[var(--color-accent-mint-bright)]/10 via-surface-raised to-[var(--color-accent-mint-bright)]/5 hover:border-[var(--color-accent-mint-bright)]/50 hover:from-[var(--color-accent-mint-bright)]/15',
    iconBox: 'bg-[var(--color-accent-mint-bright)]/20 border-[var(--color-accent-mint-bright)]/20 shadow-[0_0_12px_rgba(102,210,165,0.15)]',
    iconColor: 'text-[var(--color-accent-mint-bright)]',
    badgeColor: 'bg-[var(--color-accent-mint-bright)]/20 text-[var(--color-accent-mint-bright)]',
    glow: 'bg-[var(--color-accent-mint-bright)]/8',
};

export const GRINDER_THEME: InstrumentCardTheme = {
    button: 'border-[var(--color-accent-orange)]/30 bg-gradient-to-br from-[var(--color-accent-orange)]/10 via-surface-raised to-[var(--color-accent-orange)]/5 hover:border-[var(--color-accent-orange)]/50 hover:from-[var(--color-accent-orange)]/15',
    iconBox:
        'bg-[var(--color-accent-orange)]/20 border-[var(--color-accent-orange)]/20 shadow-[0_0_12px_rgba(241,165,75,0.15)]',
    iconColor: 'text-[var(--color-accent-orange)]',
    badgeColor: 'bg-[var(--color-accent-orange)]/20 text-[var(--color-accent-orange)]',
    glow: 'bg-[var(--color-accent-orange)]/8',
};

export const YEAST_THEME: InstrumentCardTheme = {
    button: 'border-[var(--color-accent-rose)]/30 bg-gradient-to-br from-[var(--color-accent-rose)]/10 via-surface-raised to-[var(--color-accent-rose)]/5 hover:border-[var(--color-accent-rose)]/50 hover:from-[var(--color-accent-rose)]/15',
    iconBox: 'bg-[var(--color-accent-rose)]/20 border-[var(--color-accent-rose)]/20 shadow-[0_0_12px_rgba(192,96,112,0.15)]',
    iconColor: 'text-[var(--color-accent-rose)]',
    badgeColor: 'bg-[var(--color-accent-rose)]/20 text-[var(--color-accent-rose)]',
    glow: 'bg-[var(--color-accent-rose)]/8',
};

export const CRUMBS_THEME: InstrumentCardTheme = {
    button: 'border-[var(--color-accent-lavender)]/30 bg-gradient-to-br from-[var(--color-accent-lavender)]/10 via-surface-raised to-[var(--color-accent-lavender)]/5 hover:border-[var(--color-accent-lavender)]/50 hover:from-[var(--color-accent-lavender)]/15',
    iconBox:
        'bg-[var(--color-accent-lavender)]/20 border-[var(--color-accent-lavender)]/20 shadow-[0_0_12px_rgba(168,155,196,0.15)]',
    iconColor: 'text-[var(--color-accent-lavender)]',
    badgeColor: 'bg-[var(--color-accent-lavender)]/20 text-[var(--color-accent-lavender)]',
    glow: 'bg-[var(--color-accent-lavender)]/8',
};

export const GRAND_BOULE_THEME: InstrumentCardTheme = {
    button: 'border-neutral-400/25 bg-gradient-to-br from-neutral-300/10 via-surface-raised to-neutral-400/5 hover:border-neutral-300/45 hover:from-neutral-300/15',
    iconBox: 'bg-neutral-300/15 border-neutral-400/20 shadow-[0_0_12px_rgba(200,200,200,0.10)]',
    iconColor: 'text-neutral-300',
    badgeColor: 'bg-neutral-400/20 text-neutral-300',
    glow: 'bg-neutral-400/8',
};

export const CRUST_THEME: InstrumentCardTheme = {
    button: 'border-[var(--color-accent-copper)]/30 bg-gradient-to-br from-[var(--color-accent-copper)]/10 via-surface-raised to-[var(--color-accent-copper)]/5 hover:border-[var(--color-accent-copper)]/50 hover:from-[var(--color-accent-copper)]/15',
    iconBox: 'bg-[var(--color-accent-copper)]/20 border-[var(--color-accent-copper)]/20 shadow-[0_0_12px_rgba(184,136,104,0.15)]',
    iconColor: 'text-[var(--color-accent-copper)]',
    badgeColor: 'bg-[var(--color-accent-copper)]/20 text-[var(--color-accent-copper)]',
    glow: 'bg-[var(--color-accent-copper)]/8',
};

export const InstrumentCard = ({
    icon: Icon,
    label,
    badge,
    description,
    onClick,
    theme,
}: InstrumentCardProps): ReactElement => (
    <DawChooserCard
        className={`group relative overflow-hidden cursor-pointer ${theme.button}`}
        title={label}
        description={description}
        badge={
            <span className={`rounded px-1 py-px text-[8px] font-bold uppercase tracking-wider ${theme.badgeColor}`}>
                {badge}
            </span>
        }
        startSlot={
            <div className={`flex h-9 w-9 items-center justify-center rounded-lg border ${theme.iconBox}`}>
                <Icon className={`size-4.5 ${theme.iconColor}`} />
            </div>
        }
        onClick={onClick}
    >
        <div className={`absolute -top-6 -right-6 w-16 h-16 rounded-full blur-xl pointer-events-none ${theme.glow}`} />
    </DawChooserCard>
);
