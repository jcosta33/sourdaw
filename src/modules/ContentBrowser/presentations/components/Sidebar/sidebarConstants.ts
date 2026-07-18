import {
    type LucideIcon,
    Waves,
    AudioLines,
    Cloud,
    Zap,
    Piano,
    Drum,
    Sparkles,
    Mic,
    Guitar,
    Music2,
} from 'lucide-react';

import { type SoundPresetCategory } from '../../../models/SoundPresetViewTypes';

export type SampleItem = {
    id: string;
    name: string;
    category: string;
    duration: string;
    audioBufferId?: string;
    durationSeconds?: number;
};

export const PRESET_CATEGORIES: SoundPresetCategory[] = [
    'synth',
    'bass',
    'pad',
    'lead',
    'keys',
    'drums',
    'fx',
    'vocal',
    'guitar',
    'strings',
];

export const CATEGORY_ICONS: Record<SoundPresetCategory, LucideIcon> = {
    synth: Waves,
    bass: AudioLines,
    pad: Cloud,
    lead: Zap,
    keys: Piano,
    drums: Drum,
    fx: Sparkles,
    vocal: Mic,
    guitar: Guitar,
    strings: Music2,
};

export const CATEGORY_COLORS: Record<SoundPresetCategory, string> = {
    synth: 'bg-[var(--color-accent-lavender)]/20 text-[var(--color-accent-lavender)]',
    bass: 'bg-[var(--color-state-danger)]/20 text-[var(--color-state-danger)]',
    pad: 'bg-[var(--color-accent-cyan)]/20 text-[var(--color-accent-cyan)]',
    lead: 'bg-[var(--color-accent-peach)]/20 text-[var(--color-accent-peach)]',
    keys: 'bg-[var(--color-accent-cyan)]/20 text-[var(--color-accent-cyan)]',
    drums: 'bg-[var(--color-accent-peach)]/20 text-[var(--color-accent-peach)]',
    fx: 'bg-[var(--color-accent-lavender)]/20 text-[var(--color-accent-lavender)]',
    vocal: 'bg-[var(--color-accent-mint)]/20 text-[var(--color-accent-mint)]',
    guitar: 'bg-[var(--color-accent-peach)]/20 text-[var(--color-accent-peach)]',
    strings: 'bg-[var(--color-accent-lavender)]/20 text-[var(--color-accent-lavender)]',
};
