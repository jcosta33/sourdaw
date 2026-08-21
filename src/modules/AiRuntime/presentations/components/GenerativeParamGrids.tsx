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
import { cn } from '#/utils/Styles/cn';

type GridProps = {
    value: string;
    onChange: (val: string) => void;
};

type OptionDef = {
    id: string;
    label: string;
    Icon: ElementType<{ className?: string }>;
    colorClass: string;
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
                return (
                    <button
                        key={opt.id}
                        type="button"
                        aria-pressed={isSelected}
                        onClick={() => onChange(isSelected ? '' : opt.id)}
                        className={cn(
                            'relative overflow-hidden flex flex-col items-center justify-center p-3 gap-2 rounded-lg border transition-all duration-300 ease-out group',
                            isSelected
                                ? `border-${opt.colorClass}-500/50 bg-${opt.colorClass}-500/10 shadow-[0_0_15px_rgba(0,0,0,0.1)] ring-1 ring-${opt.colorClass}-500/30`
                                : 'border-border/40 bg-surface-base hover:bg-surface-raised hover:border-border/80'
                        )}
                    >
                        {/* Glow effect for selected state */}
                        {isSelected ? (
                            <div
                                className={cn(
                                    'absolute inset-0 opacity-20 bg-gradient-to-t pb-[10px]',
                                    `from-${opt.colorClass}-500 to-transparent`
                                )}
                            />
                        ) : null}
                        <opt.Icon
                            className={cn(
                                'size-5 transition-colors duration-300 relative z-10',
                                isSelected
                                    ? `text-${opt.colorClass}-400 drop-shadow-sm`
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
                    </button>
                );
            })}
        </Grid>
    );
};

const GENRES: OptionDef[] = [
    { id: 'Lo-Fi Hip Hop', label: 'Lo-Fi', Icon: Coffee, colorClass: 'orange' },
    { id: 'EDM / House', label: 'EDM / House', Icon: Headphones, colorClass: 'blue' },
    { id: 'Cinematic Orchestral', label: 'Cinematic', Icon: Film, colorClass: 'yellow' },
    { id: 'Synthwave', label: 'Synthwave', Icon: Sunset, colorClass: 'fuchsia' },
    { id: 'Rock', label: 'Rock', Icon: Zap, colorClass: 'red' },
];

export const GenreGrid = (props: GridProps) => <GridContainer options={GENRES} gridTestId="genre-grid" {...props} />;

const MOODS: OptionDef[] = [
    { id: 'Chill / Relaxed', label: 'Chill', Icon: Cloud, colorClass: 'sky' },
    { id: 'Aggressive / Dark', label: 'Aggressive', Icon: Flame, colorClass: 'red' },
    { id: 'Upbeat / Happy', label: 'Upbeat', Icon: Sun, colorClass: 'yellow' },
    { id: 'Melancholy', label: 'Melancholy', Icon: CloudRain, colorClass: 'indigo' },
    { id: 'Epic', label: 'Epic', Icon: Mountain, colorClass: 'emerald' },
];

export const MoodGrid = (props: GridProps) => <GridContainer options={MOODS} gridTestId="mood-grid" {...props} />;

const INSTRUMENTS: OptionDef[] = [
    { id: 'Acoustic Piano', label: 'Acoustic Piano', Icon: Piano, colorClass: 'slate' },
    { id: 'Analog Synthesizer', label: 'Analog Synth', Icon: Sliders, colorClass: 'purple' },
    { id: 'Drum Kit', label: 'Drum Kit', Icon: Disc3, colorClass: 'amber' },
    { id: 'Electric Bass', label: 'Electric Bass', Icon: Music2, colorClass: 'rose' },
    { id: 'String Section', label: 'Strings', Icon: Music4, colorClass: 'amber' },
];

export const InstrumentGrid = (props: GridProps) => (
    <GridContainer options={INSTRUMENTS} gridTestId="instrument-grid" {...props} />
);
