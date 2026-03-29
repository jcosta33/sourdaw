import { type ReactElement } from 'react';
import { type LucideIcon } from 'lucide-react';

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
    button: 'border-[var(--color-accent-lavender)]/30 bg-gradient-to-br from-[var(--color-accent-lavender)]/10 via-surface-raised to-[var(--color-accent-lavender)]/5 hover:border-[var(--color-accent-lavender)]/50 hover:from-[var(--color-accent-lavender)]/15',
    iconBox: 'bg-[var(--color-accent-lavender)]/20 border-[var(--color-accent-lavender)]/20 shadow-[0_0_12px_var(--color-accent-lavender)/15]',
    iconColor: 'text-[var(--color-accent-lavender)]',
    badgeColor: 'bg-[var(--color-accent-lavender)]/20 text-[var(--color-accent-lavender)]',
    glow: 'bg-[var(--color-accent-lavender)]/8',
};

export const TOASTER_THEME: InstrumentCardTheme = {
    button: 'border-[var(--color-accent-peach)]/30 bg-gradient-to-br from-[var(--color-accent-peach)]/10 via-surface-raised to-[var(--color-accent-peach)]/5 hover:border-[var(--color-accent-peach)]/50 hover:from-[var(--color-accent-peach)]/15',
    iconBox: 'bg-[var(--color-accent-peach)]/20 border-[var(--color-accent-peach)]/20 shadow-[0_0_12px_var(--color-accent-peach)/15]',
    iconColor: 'text-[var(--color-accent-peach)]',
    badgeColor: 'bg-[var(--color-accent-peach)]/20 text-[var(--color-accent-peach)]',
    glow: 'bg-[var(--color-accent-peach)]/8',
};

export const LEVAIN_THEME: InstrumentCardTheme = {
    button: 'border-amber-500/30 bg-gradient-to-br from-amber-500/10 via-surface-raised to-amber-500/5 hover:border-amber-500/50 hover:from-amber-500/15',
    iconBox: 'bg-amber-500/20 border-amber-500/20 shadow-[0_0_12px_rgba(245,158,11,0.15)]',
    iconColor: 'text-amber-400',
    badgeColor: 'bg-amber-500/20 text-amber-400',
    glow: 'bg-amber-500/8',
};

export const InstrumentCard = ({ icon: Icon, label, badge, description, onClick, theme }: InstrumentCardProps): ReactElement => (
    <button
        type="button"
        className={`w-full group relative overflow-hidden rounded-lg border transition-all duration-200 cursor-pointer ${theme.button}`}
        onClick={onClick}
    >
        <div className="flex items-center gap-3 px-3 py-3">
            <div className={`flex items-center justify-center w-9 h-9 rounded-lg border ${theme.iconBox}`}>
                <Icon className={`size-4.5 ${theme.iconColor}`} />
            </div>
            <div className="flex-1 min-w-0 text-left">
                <div className="flex items-center gap-1.5">
                    <span className="text-[12px] font-bold text-foreground tracking-tight">{label}</span>
                    <span className={`px-1 py-px rounded text-[8px] font-bold uppercase tracking-wider ${theme.badgeColor}`}>
                        {badge}
                    </span>
                </div>
                <div className="text-[9px] text-muted-foreground/80 leading-tight mt-0.5">
                    {description}
                </div>
            </div>
        </div>
        <div className={`absolute -top-6 -right-6 w-16 h-16 rounded-full blur-xl pointer-events-none ${theme.glow}`} />
    </button>
);
