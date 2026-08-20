/**
 * Curated free sample sources — direct links, no signup, no auth.
 * All CC0 or CC-BY licensed and safe for commercial use.
 */
import { type ReactElement } from 'react';

import { ExternalLink, Package, Music, Drum, Guitar, Piano, Mic2, Waves } from 'lucide-react';

import { DawPickerRow } from '#/components/daw/DawPickerRow';
import { Row, Stack } from '#/components/layout';

import { type PreviewHandle } from '../../hooks/usePreviewAudio';

type SampleSource = {
    id: string;
    name: string;
    description: string;
    license: string;
    icon: typeof Package;
    url: string;
    category: string;
};

const SOURCES: readonly SampleSource[] = [
    // ── Drums & Percussion ──
    {
        id: 'lmms-assets',
        name: 'LMMS Drum Samples',
        description: 'Kicks, snares, hats, toms, percussion. FLAC 44.1kHz.',
        license: 'CC0',
        icon: Drum,
        url: 'https://github.com/LMMS/assets/tree/master/Samples',
        category: 'drums',
    },
    {
        id: 'vcsl-percussion',
        name: 'VCSL Percussion',
        description: 'Timpani, cymbals, triangle, glockenspiel, marimba. 24-bit WAV.',
        license: 'CC0',
        icon: Drum,
        url: 'https://github.com/sgossner/VCSL',
        category: 'drums',
    },
    {
        id: 'sfz-gm-drums',
        name: 'GM Drum Bank',
        description: 'Full General MIDI drum kit. Multi-velocity samples.',
        license: 'CC0/CC-BY',
        icon: Drum,
        url: 'https://github.com/sfzinstruments/Discord-SFZ-GM-Bank',
        category: 'drums',
    },

    // ── Instruments ──
    {
        id: 'splendid-grand',
        name: 'Splendid Grand Piano',
        description: 'Steinway concert grand. Multi-velocity, round-robin. FLAC + SFZ.',
        license: 'Public Domain',
        icon: Piano,
        url: 'https://github.com/sfzinstruments/SplendidGrandPiano',
        category: 'instruments',
    },
    {
        id: 'sfz-basses',
        name: 'Black & Blue Basses',
        description: 'Electric bass — fingered, picked, slapped. Multi-articulation.',
        license: 'CC0',
        icon: Guitar,
        url: 'https://github.com/sfzinstruments/BlackAndBlueBasses',
        category: 'instruments',
    },
    {
        id: 'sfz-ergo-eub',
        name: 'Ergo EUB',
        description: 'Electric upright bass — arco and pizzicato.',
        license: 'CC0',
        icon: Guitar,
        url: 'https://github.com/sfzinstruments/Ergo-EUB',
        category: 'instruments',
    },

    // ── Orchestral ──
    {
        id: 'iowa-mis',
        name: 'Iowa Musical Instruments',
        description: '23+ orchestral instruments. Anechoic chamber. Up to 24-bit/96kHz.',
        license: 'Unrestricted',
        icon: Music,
        url: 'https://theremin.music.uiowa.edu/MIS.html',
        category: 'orchestral',
    },
    {
        id: 'vcsl-orchestral',
        name: 'VCSL Full Library',
        description: 'Woodwinds, brass, strings, experimental. SFZ mappings included.',
        license: 'CC0',
        icon: Music,
        url: 'https://github.com/sgossner/VCSL/releases/tag/v1.2.2-RC',
        category: 'orchestral',
    },
    {
        id: 'philharmonia',
        name: 'Philharmonia Orchestra',
        description: 'Note samples from a world-class orchestra. All standard instruments.',
        license: 'CC-BY-SA',
        icon: Music,
        url: 'https://philharmonia.co.uk/resources/sound-samples/',
        category: 'orchestral',
    },

    // ── Synths & Electronic ──
    {
        id: 'olpc-berklee',
        name: 'OLPC Berklee Samples',
        description: 'Ethnic instruments, synths, percussion, FX. 8,000+ samples.',
        license: 'CC-BY',
        icon: Waves,
        url: 'https://archive.org/details/olpc-sound-samples-v2.7z',
        category: 'synths',
    },
    {
        id: 'ccmixter-stems',
        name: 'ccMixter Stems & Loops',
        description: 'Stems, loops, a cappellas from remix community. Commercially usable.',
        license: 'CC-BY',
        icon: Waves,
        url: 'https://dig.ccmixter.org/',
        category: 'synths',
    },
    {
        id: 'opengameart',
        name: 'OpenGameArt Audio',
        description: 'Sound effects, chiptune, retro, jingles. All free licenses.',
        license: 'CC0/CC-BY',
        icon: Waves,
        url: 'https://opengameart.org/art-search-advanced?keys=&type=music',
        category: 'synths',
    },

    // ── Vocals ──
    {
        id: 'ccmixter-vocals',
        name: 'ccMixter Vocals',
        description: 'A cappellas and vocal stems cleared for commercial use.',
        license: 'CC-BY',
        icon: Mic2,
        url: 'https://dig.ccmixter.org/tags/vocals',
        category: 'vocals',
    },

    // ── General / Multi-category ──
    {
        id: 'archive-netlabels',
        name: 'Internet Archive Netlabels',
        description: 'CC-licensed albums from independent labels. Full tracks and stems.',
        license: 'CC0/CC-BY',
        icon: Package,
        url: 'https://archive.org/details/netlabels',
        category: 'general',
    },
    {
        id: 'sfzinstruments-org',
        name: 'sfzinstruments Collection',
        description: '20+ open-source SFZ instruments. Piano, bass, strings, drums.',
        license: 'CC0/CC-BY',
        icon: Package,
        url: 'https://github.com/sfzinstruments',
        category: 'general',
    },
];

const CATEGORY_META: Record<string, { label: string; color: string; iconColor: string; bgColor: string }> = {
    drums: {
        label: 'Drums & Percussion',
        color: 'text-[var(--color-accent-peach)]',
        iconColor: 'text-[var(--color-accent-peach)]/70',
        bgColor: 'bg-[var(--color-accent-peach)]/8',
    },
    instruments: {
        label: 'Instruments',
        color: 'text-[var(--color-accent-cyan)]',
        iconColor: 'text-[var(--color-accent-cyan)]/70',
        bgColor: 'bg-[var(--color-accent-cyan)]/8',
    },
    orchestral: {
        label: 'Orchestral',
        color: 'text-[var(--color-accent-lavender)]',
        iconColor: 'text-[var(--color-accent-lavender)]/70',
        bgColor: 'bg-[var(--color-accent-lavender)]/8',
    },
    synths: {
        label: 'Synths & Electronic',
        color: 'text-[var(--color-accent-orange)]',
        iconColor: 'text-[var(--color-accent-orange)]/70',
        bgColor: 'bg-[var(--color-accent-orange)]/8',
    },
    vocals: {
        label: 'Vocals',
        color: 'text-pink-400',
        iconColor: 'text-pink-400/70',
        bgColor: 'bg-pink-400/8',
    },
    general: {
        label: 'Collections',
        color: 'text-emerald-400',
        iconColor: 'text-emerald-400/70',
        bgColor: 'bg-emerald-400/8',
    },
};

const CATEGORY_ORDER = ['drums', 'instruments', 'orchestral', 'synths', 'vocals', 'general'];

type Props = { preview: PreviewHandle };

export const OnlineSampleBrowser = (_props: Props): ReactElement => {
    const grouped = new Map<string, SampleSource[]>();
    for (const source of SOURCES) {
        const list = grouped.get(source.category) ?? [];
        list.push(source);
        grouped.set(source.category, list);
    }

    return (
        <Stack gap={3}>
            <p className="text-[9px] text-muted-foreground/60 leading-relaxed">
                Free sample libraries — download and import into your project.
            </p>

            {CATEGORY_ORDER.map((cat) => {
                const sources = grouped.get(cat);
                if (!sources) {
                    return null;
                }
                const meta = CATEGORY_META[cat] ?? {
                    label: cat,
                    color: 'text-foreground/60',
                    iconColor: 'text-muted-foreground/50',
                    bgColor: '',
                };
                return (
                    <Stack gap={0.5} key={cat}>
                        <Row gap={1.5} className="pt-1 px-0.5">
                            <span className={`text-[9px] font-bold uppercase tracking-widest ${meta.color}`}>
                                {meta.label}
                            </span>
                            <div className={`flex-1 h-px ${meta.bgColor.replace('/8', '/20')}`} />
                        </Row>
                        {sources.map((source) => {
                            const Icon = source.icon;
                            return (
                                <DawPickerRow
                                    key={source.id}
                                    href={source.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className={`p-1.5 hover:${meta.bgColor}`}
                                    startSlot={
                                        <div
                                            className={`size-5 rounded flex items-center justify-center ${meta.bgColor} shrink-0`}
                                        >
                                            <Icon
                                                className={`size-3 ${meta.iconColor} group-hover:${meta.color} transition-colors`}
                                            />
                                        </div>
                                    }
                                    heading={source.name}
                                    description={source.description}
                                    endSlot={
                                        <Row gap={1}>
                                            <ExternalLink className="size-2 text-muted-foreground/30 group-hover:text-muted-foreground/60" />
                                            <span className="rounded bg-[var(--color-state-success)]/10 px-1 py-0.5 text-[7px] font-medium text-[var(--color-state-success)]/70">
                                                {source.license}
                                            </span>
                                        </Row>
                                    }
                                />
                            );
                        })}
                    </Stack>
                );
            })}
        </Stack>
    );
};
