/**
 * Curated free sample sources — direct links, no signup, no auth.
 * All CC0 or CC-BY licensed and safe for commercial use.
 */
import { type ReactElement } from 'react';
import { ExternalLink, Package, Music, Drum, Guitar, Piano, Mic2, Waves } from 'lucide-react';
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

const CATEGORY_LABELS: Record<string, string> = {
    drums: 'Drums & Percussion',
    instruments: 'Instruments',
    orchestral: 'Orchestral',
    synths: 'Synths & Electronic',
    vocals: 'Vocals',
    general: 'Collections',
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
        <div className="space-y-3">
            <p className="text-[9px] text-muted-foreground/60 leading-relaxed">
                Free sample libraries — download and import into your project.
            </p>

            {CATEGORY_ORDER.map((cat) => {
                const sources = grouped.get(cat);
                if (!sources) { return null; }
                return (
                    <div key={cat} className="space-y-1">
                        <div className="text-[9px] font-semibold text-foreground/60 uppercase tracking-wider pt-1">
                            {CATEGORY_LABELS[cat] ?? cat}
                        </div>
                        {sources.map((source) => {
                            const Icon = source.icon;
                            return (
                                <a
                                    key={source.id}
                                    href={source.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="flex items-start gap-2 p-1.5 rounded-md hover:bg-white/[0.04] group cursor-pointer"
                                >
                                    <Icon className="size-3 text-muted-foreground/50 group-hover:text-[var(--color-accent-lavender)] mt-0.5 shrink-0 transition-colors" />
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-1">
                                            <span className="text-[10px] font-medium text-foreground/80 group-hover:text-foreground transition-colors">
                                                {source.name}
                                            </span>
                                            <ExternalLink className="size-2 text-muted-foreground/30 group-hover:text-muted-foreground/60" />
                                            <span className="text-[7px] font-medium text-[var(--color-state-success)]/70 ml-auto shrink-0">
                                                {source.license}
                                            </span>
                                        </div>
                                        <div className="text-[9px] text-muted-foreground/50 leading-snug">
                                            {source.description}
                                        </div>
                                    </div>
                                </a>
                            );
                        })}
                    </div>
                );
            })}
        </div>
    );
};
