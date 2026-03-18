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
import { type SoundPresetCategory } from '../../../useCases/workspaceViewActions';

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
    synth: 'bg-purple-500/20 text-purple-300',
    bass: 'bg-red-500/20 text-red-300',
    pad: 'bg-cyan-500/20 text-cyan-300',
    lead: 'bg-yellow-500/20 text-yellow-300',
    keys: 'bg-blue-500/20 text-blue-300',
    drums: 'bg-orange-500/20 text-orange-300',
    fx: 'bg-pink-500/20 text-pink-300',
    vocal: 'bg-green-500/20 text-green-300',
    guitar: 'bg-amber-500/20 text-amber-300',
    strings: 'bg-indigo-500/20 text-indigo-300',
};
