import { type ReactElement, type ElementType } from 'react';

import {
    Coffee,
    Headphones,
    Film,
    Sunset,
    Zap,
    Cloud,
    Flame,
    Sun,
    CloudRain,
    Mountain,
    Piano,
    Sliders,
    Disc3,
    Music2,
    Music4,
} from 'lucide-react';

import { Grid } from '#/components/layout';
import { Button } from '#/components/ui/button';
import { cn } from '#/utils/Styles/cn';

type GridProps = {
    value: string;
    onChange: (val: string) => void;
};

type Tone =
    | 'amber'
    | 'blue'
    | 'emerald'
    | 'fuchsia'
    | 'indigo'
    | 'orange'
    | 'purple'
    | 'red'
    | 'rose'
    | 'sky'
    | 'slate'
    | 'yellow';

type ToneClasses = {
    card: string;
    glow: string;
    icon: string;
};

// Tailwind emits a utility only when its complete name appears in source, so each tone spells its classes out.
const TONE_CLASSES: Record<Tone, ToneClasses> = {
    amber: {
        card: 'border-amber-500/50 bg-amber-500/10 ring-amber-500/30',
        glow: 'from-amber-500',
        icon: 'text-amber-400',
    },
    blue: { card: 'border-blue-500/50 bg-blue-500/10 ring-blue-500/30', glow: 'from-blue-500', icon: 'text-blue-400' },
    emerald: {
        card: 'border-emerald-500/50 bg-emerald-500/10 ring-emerald-500/30',
        glow: 'from-emerald-500',
        icon: 'text-emerald-400',
    },
    fuchsia: {
        card: 'border-fuchsia-500/50 bg-fuchsia-500/10 ring-fuchsia-500/30',
        glow: 'from-fuchsia-500',
        icon: 'text-fuchsia-400',
    },
    indigo: {
        card: 'border-indigo-500/50 bg-indigo-500/10 ring-indigo-500/30',
        glow: 'from-indigo-500',
        icon: 'text-indigo-400',
    },
    orange: {
        card: 'border-orange-500/50 bg-orange-500/10 ring-orange-500/30',
        glow: 'from-orange-500',
        icon: 'text-orange-400',
    },
    purple: {
        card: 'border-purple-500/50 bg-purple-500/10 ring-purple-500/30',
        glow: 'from-purple-500',
        icon: 'text-purple-400',
    },
    red: { card: 'border-red-500/50 bg-red-500/10 ring-red-500/30', glow: 'from-red-500', icon: 'text-red-400' },
    rose: { card: 'border-rose-500/50 bg-rose-500/10 ring-rose-500/30', glow: 'from-rose-500', icon: 'text-rose-400' },
    sky: { card: 'border-sky-500/50 bg-sky-500/10 ring-sky-500/30', glow: 'from-sky-500', icon: 'text-sky-400' },
    slate: {
        card: 'border-slate-500/50 bg-slate-500/10 ring-slate-500/30',
        glow: 'from-slate-500',
        icon: 'text-slate-400',
    },
    yellow: {
        card: 'border-yellow-500/50 bg-yellow-500/10 ring-yellow-500/30',
        glow: 'from-yellow-500',
        icon: 'text-yellow-400',
    },
};

type OptionDef = {
    id: string;
    label: string;
    Icon: ElementType<{ className?: string }>;
    tone: Tone;
};

type GridContainerProps = GridProps & {
    options: OptionDef[];
    gridTestId: string;
};

const GridContainer = ({ options, value, onChange, gridTestId }: GridContainerProps): ReactElement => {
    return (
        <Grid cols={2} gap={2} data-testid={gridTestId}>
            {options.map((opt) => {
                const isSelected = value === opt.id;
                const tone = TONE_CLASSES[opt.tone];
                return (
                    <Button
                        variant="bare"
                        size="bare"
                        key={opt.id}
                        type="button"
                        aria-pressed={isSelected}
                        onClick={() => onChange(isSelected ? '' : opt.id)}
                        className={cn(
                            'relative overflow-hidden flex flex-col items-center justify-center p-3 gap-2 rounded-lg border transition-all duration-300 ease-out group',
                            isSelected
                                ? cn(tone.card, 'shadow-[0_0_15px_rgba(0,0,0,0.1)] ring-1')
                                : 'border-border/40 bg-surface-base hover:bg-surface-raised hover:border-border/80'
                        )}
                    >
                        {/* Glow effect for selected state */}
                        {isSelected ? (
                            <div
                                className={cn(
                                    'absolute inset-0 opacity-20 bg-gradient-to-t pb-[10px]',
                                    tone.glow,
                                    'to-transparent'
                                )}
                            />
                        ) : null}
                        <opt.Icon
                            className={cn(
                                'size-5 transition-colors duration-300 relative z-10',
                                isSelected
                                    ? cn(tone.icon, 'drop-shadow-sm')
                                    : 'text-muted-foreground group-hover:text-foreground/80'
                            )}
                        />
                        <span
                            className={cn(
                                'text-[10px] font-medium text-center leading-tight relative z-10 transition-colors duration-300',
                                isSelected
                                    ? 'text-foreground drop-shadow-sm'
                                    : 'text-muted-foreground group-hover:text-foreground/90'
                            )}
                        >
                            {opt.label}
                        </span>
                    </Button>
                );
            })}
        </Grid>
    );
};

const GENRES: OptionDef[] = [
    { id: 'Lo-Fi Hip Hop', label: 'Lo-Fi', Icon: Coffee, tone: 'orange' },
    { id: 'EDM / House', label: 'EDM / House', Icon: Headphones, tone: 'blue' },
    { id: 'Cinematic Orchestral', label: 'Cinematic', Icon: Film, tone: 'yellow' },
    { id: 'Synthwave', label: 'Synthwave', Icon: Sunset, tone: 'fuchsia' },
    { id: 'Rock', label: 'Rock', Icon: Zap, tone: 'red' },
];

export const GenreGrid = (props: GridProps) => <GridContainer options={GENRES} gridTestId="genre-grid" {...props} />;

const MOODS: OptionDef[] = [
    { id: 'Chill / Relaxed', label: 'Chill', Icon: Cloud, tone: 'sky' },
    { id: 'Aggressive / Dark', label: 'Aggressive', Icon: Flame, tone: 'red' },
    { id: 'Upbeat / Happy', label: 'Upbeat', Icon: Sun, tone: 'yellow' },
    { id: 'Melancholy', label: 'Melancholy', Icon: CloudRain, tone: 'indigo' },
    { id: 'Epic', label: 'Epic', Icon: Mountain, tone: 'emerald' },
];

export const MoodGrid = (props: GridProps) => <GridContainer options={MOODS} gridTestId="mood-grid" {...props} />;

const INSTRUMENTS: OptionDef[] = [
    { id: 'Acoustic Piano', label: 'Acoustic Piano', Icon: Piano, tone: 'slate' },
    { id: 'Analog Synthesizer', label: 'Analog Synth', Icon: Sliders, tone: 'purple' },
    { id: 'Drum Kit', label: 'Drum Kit', Icon: Disc3, tone: 'amber' },
    { id: 'Electric Bass', label: 'Electric Bass', Icon: Music2, tone: 'rose' },
    { id: 'String Section', label: 'Strings', Icon: Music4, tone: 'amber' },
];

export const InstrumentGrid = (props: GridProps) => (
    <GridContainer options={INSTRUMENTS} gridTestId="instrument-grid" {...props} />
);
