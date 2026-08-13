import { type ReactElement } from 'react';

import { getPreviewLoop } from '#/modules/Project/useCases';

type TemplatePreviewThumbProps = {
    templateId: string;
};

type VoiceKey = 'kick' | 'snare' | 'hat' | 'bass' | 'lead' | 'pad' | 'chord' | 'pluck';

const VIEW_WIDTH = 120;
const VIEW_HEIGHT = 40;
const VOICE_ROW_ORDER: VoiceKey[] = ['hat', 'snare', 'kick', 'chord', 'pad', 'pluck', 'lead', 'bass'];

type TemplatePalette = {
    background: string;
    grid: string;
    voices: Partial<Record<VoiceKey, string>>;
    accent: string;
};

const PALETTES: Record<string, TemplatePalette> = {
    'pop-song': {
        background: 'rgba(236, 72, 153, 0.06)',
        grid: 'rgba(236, 72, 153, 0.14)',
        accent: 'rgba(236, 72, 153, 0.9)',
        voices: {
            kick: 'rgba(244, 114, 182, 0.95)',
            snare: 'rgba(251, 207, 232, 0.95)',
            hat: 'rgba(244, 114, 182, 0.55)',
            bass: 'rgba(219, 39, 119, 0.9)',
            lead: 'rgba(255, 182, 217, 0.95)',
            chord: 'rgba(236, 72, 153, 0.7)',
        },
    },
    'hiphop-trap': {
        background: 'rgba(217, 119, 6, 0.06)',
        grid: 'rgba(217, 119, 6, 0.18)',
        accent: 'rgba(251, 191, 36, 0.95)',
        voices: {
            kick: 'rgba(251, 191, 36, 0.95)',
            snare: 'rgba(254, 240, 138, 0.95)',
            hat: 'rgba(234, 179, 8, 0.6)',
            bass: 'rgba(180, 83, 9, 0.95)',
        },
    },
    edm: {
        background: 'rgba(34, 211, 238, 0.06)',
        grid: 'rgba(34, 211, 238, 0.18)',
        accent: 'rgba(103, 232, 249, 0.95)',
        voices: {
            kick: 'rgba(34, 211, 238, 0.95)',
            snare: 'rgba(165, 243, 252, 0.95)',
            bass: 'rgba(8, 145, 178, 0.95)',
            lead: 'rgba(207, 250, 254, 0.95)',
        },
    },
    'rock-band': {
        background: 'rgba(239, 68, 68, 0.06)',
        grid: 'rgba(239, 68, 68, 0.18)',
        accent: 'rgba(248, 113, 113, 0.95)',
        voices: {
            kick: 'rgba(220, 38, 38, 0.95)',
            snare: 'rgba(252, 165, 165, 0.95)',
            hat: 'rgba(239, 68, 68, 0.55)',
            bass: 'rgba(153, 27, 27, 0.95)',
            chord: 'rgba(248, 113, 113, 0.85)',
        },
    },
    lofi: {
        background: 'rgba(180, 133, 83, 0.06)',
        grid: 'rgba(180, 133, 83, 0.2)',
        accent: 'rgba(217, 170, 120, 0.95)',
        voices: {
            kick: 'rgba(180, 133, 83, 0.95)',
            snare: 'rgba(229, 196, 156, 0.95)',
            hat: 'rgba(180, 133, 83, 0.5)',
            bass: 'rgba(120, 80, 50, 0.95)',
            chord: 'rgba(200, 150, 100, 0.85)',
        },
    },
    cinematic: {
        background: 'rgba(99, 102, 241, 0.06)',
        grid: 'rgba(139, 92, 246, 0.18)',
        accent: 'rgba(167, 139, 250, 0.95)',
        voices: {
            kick: 'rgba(99, 102, 241, 0.95)',
            pad: 'rgba(139, 92, 246, 0.7)',
            lead: 'rgba(196, 181, 253, 0.95)',
            bass: 'rgba(67, 56, 202, 0.95)',
        },
    },
    podcast: {
        background: 'rgba(148, 163, 184, 0.06)',
        grid: 'rgba(148, 163, 184, 0.18)',
        accent: 'rgba(203, 213, 225, 0.95)',
        voices: {
            pluck: 'rgba(203, 213, 225, 0.95)',
            pad: 'rgba(148, 163, 184, 0.55)',
        },
    },
    'singer-songwriter': {
        background: 'rgba(34, 197, 94, 0.06)',
        grid: 'rgba(34, 197, 94, 0.18)',
        accent: 'rgba(134, 239, 172, 0.95)',
        voices: {
            pluck: 'rgba(34, 197, 94, 0.95)',
            lead: 'rgba(187, 247, 208, 0.95)',
        },
    },
    ambient: {
        background: 'rgba(20, 184, 166, 0.06)',
        grid: 'rgba(20, 184, 166, 0.18)',
        accent: 'rgba(94, 234, 212, 0.95)',
        voices: {
            pad: 'rgba(20, 184, 166, 0.7)',
            pluck: 'rgba(153, 246, 228, 0.95)',
        },
    },
    'demo-nebula-drift': {
        background: 'rgba(79, 70, 229, 0.06)',
        grid: 'rgba(79, 70, 229, 0.22)',
        accent: 'rgba(165, 180, 252, 0.95)',
        voices: {
            pad: 'rgba(79, 70, 229, 0.6)',
            lead: 'rgba(199, 210, 254, 0.95)',
            bass: 'rgba(55, 48, 163, 0.95)',
        },
    },
};

const FALLBACK_PALETTE: TemplatePalette = {
    background: 'rgba(255, 255, 255, 0.04)',
    grid: 'rgba(255, 255, 255, 0.1)',
    accent: 'rgba(255, 255, 255, 0.6)',
    voices: {},
};

function paletteFor(templateId: string): TemplatePalette {
    return PALETTES[templateId] ?? FALLBACK_PALETTE;
}

export const TemplatePreviewThumb = ({ templateId }: TemplatePreviewThumbProps): ReactElement => {
    const preview = getPreviewLoop(templateId);
    const palette = paletteFor(templateId);

    if (!preview) {
        return (
            <svg
                width={VIEW_WIDTH}
                height={VIEW_HEIGHT}
                viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
                aria-hidden="true"
                className="rounded-md"
            >
                <rect x="0" y="0" width={VIEW_WIDTH} height={VIEW_HEIGHT} fill={palette.background} />
                <line x1="0" y1={VIEW_HEIGHT / 2} x2={VIEW_WIDTH} y2={VIEW_HEIGHT / 2} stroke={palette.grid} />
            </svg>
        );
    }

    const presentVoices = new Set<VoiceKey>();
    for (const event of preview.events) {
        presentVoices.add(event.voice);
    }
    const rowCount = Math.max(1, presentVoices.size);
    const paddingY = 3;
    const rowHeight = (VIEW_HEIGHT - paddingY * 2) / rowCount;
    const blockPadY = Math.max(1, rowHeight * 0.18);

    const voicesOrdered = VOICE_ROW_ORDER.filter((v) => presentVoices.has(v));
    const voiceRowMap = new Map<VoiceKey, number>();
    for (const [idx, voice] of voicesOrdered.entries()) {
        voiceRowMap.set(voice, idx);
    }

    // 4 is the *template's* meter, not the transport's. `TemplatePreview` carries no
    // time signature and every shipped template calls `initProject` with `timeSig: [4, 4]`,
    // so these loops are authored in 4/4. Reading `transportStore.timeSignatureNumerator`
    // here would redraw a 4/4 thumbnail on a 3-beat grid whenever the currently-open
    // project happened to be in 3/4. Give `TemplatePreview` a meter field before varying this.
    const BEATS_PER_BAR = 4;
    const totalBeats = preview.bars * BEATS_PER_BAR;
    const beatsWithGridlines = totalBeats;
    const beatWidth = VIEW_WIDTH / totalBeats;

    const gridLines: ReactElement[] = [];
    for (let i = 1; i < beatsWithGridlines; i++) {
        const x = i * beatWidth;
        const isBarLine = i % BEATS_PER_BAR === 0;
        gridLines.push(
            <line
                key={`grid-${i}`}
                x1={x}
                y1={0}
                x2={x}
                y2={VIEW_HEIGHT}
                stroke={palette.grid}
                strokeWidth={isBarLine ? 0.6 : 0.3}
            />
        );
    }

    const blocks: ReactElement[] = [];
    for (const [idx, event] of preview.events.entries()) {
        const rowIndex = voiceRowMap.get(event.voice) ?? rowCount - 1;
        const y = paddingY + rowIndex * rowHeight + blockPadY;
        const height = Math.max(1, rowHeight - blockPadY * 2);
        const x = event.beat * beatWidth;
        const width = Math.max(1.2, event.duration * beatWidth - 0.6);
        const color = palette.voices[event.voice] ?? palette.accent;
        const vel = event.velocity ?? 100;
        const opacity = Math.max(0.35, Math.min(1, vel / 127));
        blocks.push(
            <rect
                key={`b-${idx}`}
                x={x}
                y={y}
                width={width}
                height={height}
                fill={color}
                opacity={opacity}
                rx={0.8}
                ry={0.8}
            />
        );
    }

    return (
        <svg
            width={VIEW_WIDTH}
            height={VIEW_HEIGHT}
            viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
            aria-hidden="true"
            className="rounded-md"
        >
            <rect x="0" y="0" width={VIEW_WIDTH} height={VIEW_HEIGHT} fill={palette.background} />
            {gridLines}
            {blocks}
        </svg>
    );
};
