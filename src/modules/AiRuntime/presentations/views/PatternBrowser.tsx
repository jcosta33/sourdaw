import { type ReactElement, useState, useRef, useEffect } from 'react';
import { Search, Music, Plus } from 'lucide-react';
import { Button } from '#/components/ui/button';
import { cn } from '#/helpers/Styles/cn';
import {
    ALL_PATTERNS,
    PATTERN_CATEGORIES,
    searchPatterns,
    type MidiPattern,
    type PatternCategory,
    type PatternNote,
} from '../../models/midiPatternLibrary';
import { trackStore } from '#/modules/Track/stores/trackStore';
import { addClip } from '#/modules/Track/useCases/clipUseCases';
import { addMidiNote } from '#/modules/Track/useCases/midiNoteCrud';
import { getTransportState } from '#/modules/Transport/useCases/transportQueries';

// ── Mini piano-roll preview ──

const PREVIEW_HEIGHT = 32;
const PREVIEW_PADDING = 2;

const MiniPianoRoll = ({ notes, lengthBeats }: { notes: PatternNote[]; lengthBeats: number }): ReactElement => {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas || notes.length === 0) {
            return;
        }

        const ctx = canvas.getContext('2d');
        if (!ctx) {
            return;
        }

        const dpr = window.devicePixelRatio || 1;
        const width = canvas.clientWidth;
        const height = PREVIEW_HEIGHT;
        canvas.width = width * dpr;
        canvas.height = height * dpr;
        ctx.scale(dpr, dpr);

        // Clear
        ctx.clearRect(0, 0, width, height);

        // Compute pitch range
        const pitches = notes.map((n) => n.pitch);
        const minPitch = Math.min(...pitches) - 1;
        const maxPitch = Math.max(...pitches) + 1;
        const pitchRange = maxPitch - minPitch || 1;

        const pxPerBeat = (width - PREVIEW_PADDING * 2) / lengthBeats;
        const noteHeight = Math.max(2, (height - PREVIEW_PADDING * 2) / pitchRange);

        // Draw notes
        ctx.fillStyle = 'rgb(168, 85, 247)'; // purple-500
        for (const note of notes) {
            const x = PREVIEW_PADDING + note.startBeat * pxPerBeat;
            const y = PREVIEW_PADDING + (maxPitch - note.pitch) * noteHeight;
            const w = Math.max(1, note.durationBeats * pxPerBeat - 0.5);
            const h = Math.max(1.5, noteHeight - 0.5);

            ctx.globalAlpha = 0.3 + (note.velocity / 127) * 0.7;
            ctx.beginPath();
            ctx.roundRect(x, y, w, h, 1);
            ctx.fill();
        }
        ctx.globalAlpha = 1;
    }, [notes, lengthBeats]);

    return (
        <canvas
            ref={canvasRef}
            className="w-full"
            style={{ height: PREVIEW_HEIGHT }}
            aria-hidden="true"
        />
    );
};

// ── Pattern Card ──

const PatternCard = ({ pattern, onInsert }: { pattern: MidiPattern; onInsert: (p: MidiPattern) => void }): ReactElement => {
    const categoryColors: Record<PatternCategory, string> = {
        chords: 'text-blue-400',
        bass: 'text-rose-400',
        drums: 'text-amber-400',
        melody: 'text-emerald-400',
    };

    const categoryBgColors: Record<PatternCategory, string> = {
        chords: 'bg-blue-500/10 border-blue-500/20',
        bass: 'bg-rose-500/10 border-rose-500/20',
        drums: 'bg-amber-500/10 border-amber-500/20',
        melody: 'bg-emerald-500/10 border-emerald-500/20',
    };

    return (
        <div className="group relative bg-surface-raised border border-border/40 rounded-lg overflow-hidden hover:border-purple-500/40 transition-all duration-200">
            {/* Mini preview */}
            <div className="bg-surface-base/80 border-b border-border/20 px-1.5 pt-1.5 pb-1">
                <MiniPianoRoll notes={pattern.notes} lengthBeats={pattern.lengthBeats} />
            </div>

            {/* Info */}
            <div className="p-2 space-y-1.5">
                <div className="flex items-center justify-between">
                    <span className="text-[11px] font-medium text-foreground/90 leading-none truncate pr-1">
                        {pattern.name}
                    </span>
                    <Button
                        variant="ghost"
                        size="icon-xs"
                        className="h-5 w-5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-purple-600/20 hover:text-purple-300"
                        onClick={() => onInsert(pattern)}
                        title="Insert at playhead"
                        aria-label={`Insert ${pattern.name} at playhead`}
                    >
                        <Plus className="size-3" />
                    </Button>
                </div>
                <div className="flex items-center gap-1 flex-wrap">
                    <span className={cn('text-[9px] font-medium px-1.5 py-0.5 rounded-full border', categoryBgColors[pattern.category], categoryColors[pattern.category])}>
                        {pattern.category}
                    </span>
                    {pattern.key && (
                        <span className="text-[9px] text-muted-foreground/70 px-1 py-0.5 bg-surface-base rounded">
                            {pattern.key}
                        </span>
                    )}
                    <span className="text-[9px] text-muted-foreground/50">
                        {pattern.lengthBeats}b
                    </span>
                </div>
            </div>
        </div>
    );
};

// ── Pattern Browser ──

export const PatternBrowser = (): ReactElement => {
    const [searchQuery, setSearchQuery] = useState('');
    const [activeCategory, setActiveCategory] = useState<PatternCategory | undefined>(undefined);

    const filteredPatterns = searchQuery || activeCategory
        ? searchPatterns(searchQuery, activeCategory)
        : ALL_PATTERNS;

    const handleInsertPattern = (pattern: MidiPattern): void => {
        const tState = trackStore.value;
        const selectedTrackId = tState?.selectedTrackId;
        let targetTrack = tState?.tracks.find((t) => t.id === selectedTrackId && t.kind === 'midi');
        if (!targetTrack) {
            targetTrack = tState?.tracks.find((t) => t.kind === 'midi');
        }

        if (!targetTrack) {
            return;
        }

        const transport = getTransportState();
        const startBeat = transport ? transport.playheadPosition : 0;
        const endBeat = startBeat + pattern.lengthBeats;

        const clip = addClip({
            trackId: targetTrack.id,
            startBeat,
            endBeat,
            name: `🎵 ${pattern.name}`,
            type: 'midi',
            isGhost: true,
        });

        if (clip) {
            for (const note of pattern.notes) {
                addMidiNote(clip.id, note.pitch, note.startBeat, note.durationBeats, note.velocity);
            }
        }
    };

    return (
        <div className="space-y-3">
            {/* Search */}
            <div className="relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-3 text-muted-foreground/50" />
                <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search patterns..."
                    className="w-full h-7 bg-surface-base border border-border/60 rounded-md pl-7 pr-2 text-xs placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-purple-500/50"
                    aria-label="Search MIDI patterns"
                />
            </div>

            {/* Category filter */}
            <div className="flex gap-1">
                <button
                    type="button"
                    className={cn(
                        'px-2 py-1 text-[10px] rounded-md font-medium transition-colors',
                        !activeCategory
                            ? 'bg-accent text-accent-foreground'
                            : 'text-muted-foreground hover:bg-surface-raised hover:text-foreground'
                    )}
                    onClick={() => setActiveCategory(undefined)}
                >
                    All
                </button>
                {PATTERN_CATEGORIES.map((cat) => (
                    <button
                        key={cat.id}
                        type="button"
                        className={cn(
                            'px-2 py-1 text-[10px] rounded-md font-medium transition-colors',
                            activeCategory === cat.id
                                ? 'bg-accent text-accent-foreground'
                                : 'text-muted-foreground hover:bg-surface-raised hover:text-foreground'
                        )}
                        onClick={() => setActiveCategory(activeCategory === cat.id ? undefined : cat.id)}
                    >
                        {cat.label}
                    </button>
                ))}
            </div>

            {/* Pattern grid */}
            {filteredPatterns.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 text-muted-foreground opacity-60">
                    <Music className="size-6 mb-2 opacity-50" />
                    <span className="text-[11px]">No patterns found</span>
                </div>
            ) : (
                <div className="grid grid-cols-2 gap-2">
                    {filteredPatterns.map((pattern) => (
                        <PatternCard
                            key={pattern.id}
                            pattern={pattern}
                            onInsert={handleInsertPattern}
                        />
                    ))}
                </div>
            )}
        </div>
    );
};
