import { type ReactElement, useState, useEffect } from 'react';
import { DawHeaderBand } from '#/components/daw/DawHeaderBand';
import { DawCompactSelect } from '#/components/daw/DawCompactSelect';
import { DawCompactTextarea } from '#/components/daw/DawCompactTextarea';
import { DawEmptyState } from '#/components/daw/DawEmptyState';
import { DawMicroBadge } from '#/components/daw/DawMicroBadge';
import { DawPluginSectionCard } from '#/components/daw/DawPluginSectionCard';
import { Button } from '#/components/ui/button';
import { Sparkles, Loader2, Music, Mic, AudioLines, Download } from 'lucide-react';
import { generateMidiVariations } from '#/modules/AiGeneration/useCases';
import { notifyUser } from '#/utils/Notification/notifyUser';
import { notifyAiChange } from '#/modules/AiRuntime/useCases';
import { midiStore } from '#/modules/MIDI/stores';
import {
    renderKokoroTts,
    renderDiffSingerPhrase,
    downloadModel,
    capabilityStore,
    modelRegistryStore,
    KokoroVoiceSelector,
    AiRenderClipPreview,
    KOKORO_MODEL_ENTRY,
    NSF_HIFIGAN_VOCODER,
    type RenderQuality,
} from '#/modules/BrowserAi';
import { useStore } from '#/infra/store/useStore';
import { tempoMapStore } from '#/modules/Transport/stores';
import { type Clip } from '../../../models/TrackViewTypes';

type RenderResult = {
    audio: Float32Array;
    sampleRate: number;
    label: string;
    name: string;
};

const TTS_SPEED_VARIANTS = [0.95, 1.0, 1.05] as const;
const SVS_SEED_VARIANTS = [42, 1337, 2025] as const;
const VARIANT_LABELS = ['A', 'B', 'C'] as const;

const QUALITY_OPTIONS: Array<{ value: RenderQuality; label: string }> = [
    { value: 'low', label: 'Low (3 steps)' },
    { value: 'standard', label: 'Standard (5 steps)' },
    { value: 'high', label: 'High (10 steps)' },
    { value: 'maximum', label: 'Maximum (20 steps)' },
];

type ClipMidiAiSectionProps = {
    clip: Clip;
};

export const ClipMidiAiSection = ({ clip }: ClipMidiAiSectionProps): ReactElement => {
    const [isGeneratingVariations, setIsGeneratingVariations] = useState(false);
    const [variationTokenCount, setVariationTokenCount] = useState(0);
    const [isRenderingTts, setIsRenderingTts] = useState(false);
    // DiffSinger SVS uses diffusion-based synthesis with configurable step count.
    const [svsRenderQuality, setSvsRenderQuality] = useState<RenderQuality>('standard');
    const [ttsText, setTtsText] = useState('');
    const [ttsVoiceId, setTtsVoiceId] = useState('af_heart');
    const [ttsSpeed, setTtsSpeed] = useState('1.0');
    const [selectedVoicebankId, setSelectedVoicebankId] = useState('');
    const [diffSingerLyrics, setDiffSingerLyrics] = useState('');
    const [isRenderingSvs, setIsRenderingSvs] = useState(false);
    const [vocalMode, setVocalMode] = useState<'spoken' | 'sung'>('spoken');
    const [ttsResults, setTtsResults] = useState<RenderResult[]>([]);
    const [svsResults, setSvsResults] = useState<RenderResult[]>([]);

    const capState = useStore(capabilityStore, { phase: 'idle' });
    const registry = useStore(modelRegistryStore, {
        ddspInstruments: [],
        kokoroModel: null,
        diffSingerVoicebanks: [],
        vocoder: null,
        storageUsedBytes: 0,
    });

    const capability = capState?.phase === 'done' ? capState.report.capability : null;
    const isUnsupported = capability === 'unsupported-browser' || capability === 'unsupported-platform';

    const kokoroStatus = registry?.kokoroModel?.status ?? 'not-downloaded';
    const kokoroProgress = registry?.kokoroModel?.downloadProgress ?? 0;
    const vocoderStatus = registry?.vocoder?.status ?? 'not-downloaded';
    const vocoderProgress = registry?.vocoder?.downloadProgress ?? 0;

    const handleGenerateVariations = async (): Promise<void> => {
        setIsGeneratingVariations(true);
        setVariationTokenCount(0);
        try {
            const count = await generateMidiVariations(clip.id, {
                onToken: (token) => setVariationTokenCount((c) => c + token.length),
            });
            notifyAiChange('MIDI variations generated', [`${String(count)} variation${count === 1 ? '' : 's'} created as alternative clips`]);
        } catch (err) {
            notifyUser(err instanceof Error ? err.message : 'Variation generation failed', 'error');
        } finally {
            setIsGeneratingVariations(false);
        }
    };

    // Reset per-clip state when the inspected clip changes so text/voice/render
    // state from one clip does not bleed into another.
    useEffect(() => {
        setTtsText('');
        setDiffSingerLyrics('');
        setTtsVoiceId('af_heart');
        setTtsSpeed('1.0');
        setVariationTokenCount(0);
        setIsGeneratingVariations(false);
        setIsRenderingTts(false);
        setIsRenderingSvs(false);
        setTtsResults([]);
        setSvsResults([]);
    }, [clip.id]);

    const handleDownloadKokoro = (): void => {
        void downloadModel({
            modelId: KOKORO_MODEL_ENTRY.id,
            family: KOKORO_MODEL_ENTRY.family,
            url: KOKORO_MODEL_ENTRY.url,
            sizeBytes: KOKORO_MODEL_ENTRY.sizeBytes,
        });
    };

    const handleDownloadVocoder = (): void => {
        void downloadModel({
            modelId: NSF_HIFIGAN_VOCODER.id,
            family: NSF_HIFIGAN_VOCODER.family,
            url: NSF_HIFIGAN_VOCODER.url,
            sizeBytes: NSF_HIFIGAN_VOCODER.sizeBytes,
        });
    };

    const handlePreviewVoice = async (): Promise<void> => {
        if (!ttsText.trim()) {
            notifyUser('Enter some text to preview', 'error');
            return;
        }
        if (kokoroStatus !== 'ready') {
            notifyUser('Download the voice model first', 'error');
            return;
        }
        const tempoState = tempoMapStore.value;
        const bpm = tempoState?.changes[0]?.tempo ?? 120;
        const beatsPerSecond = bpm / 60;
        const targetDurationSec = (clip.endBeat - clip.startBeat) / beatsPerSecond;

        const baseSpeed = parseFloat(ttsSpeed);
        if (!isFinite(baseSpeed) || baseSpeed <= 0) {
            notifyUser('Invalid speed value', 'error');
            return;
        }

        setIsRenderingTts(true);
        setTtsResults([]);
        try {
            // Sequential — the ONNX worker is single-threaded so parallel
            // calls would serialize anyway, just with noisier logs.
            const results: RenderResult[] = [];
            const textPreview = ttsText.trim().slice(0, 20) + (ttsText.trim().length > 20 ? '…' : '');
            for (let i = 0; i < TTS_SPEED_VARIANTS.length; i++) {
                const speed = baseSpeed * TTS_SPEED_VARIANTS[i]!;
                const result = await renderKokoroTts({
                    phraseId: `${clip.id}-tts-${VARIANT_LABELS[i]}`,
                    text: ttsText.trim(),
                    speakerId: ttsVoiceId,
                    speed,
                    targetDurationSec,
                });
                results.push({
                    audio: result.audio,
                    sampleRate: result.sampleRate,
                    label: VARIANT_LABELS[i]!,
                    name: `${ttsVoiceId} · ${textPreview}`,
                });
            }
            setTtsResults(results);
            notifyAiChange('Vocal preview ready', ['3 alternatives rendered — drag one onto an audio track']);
        } catch (err) {
            notifyUser(err instanceof Error ? err.message : 'TTS render failed', 'error');
        } finally {
            setIsRenderingTts(false);
        }
    };

    const voicebanks = registry?.diffSingerVoicebanks ?? [];

    // Keep selectedVoicebankId in sync with the available voicebanks list.
    // Initialises to the first voicebank on load; resets to the first if the
    // previously selected voicebank is removed from storage.
    useEffect(() => {
        if (voicebanks.length === 0) {
            setSelectedVoicebankId('');
            return;
        }
        const isValid = voicebanks.some((v) => v.id === selectedVoicebankId);
        if (!isValid) {
            setSelectedVoicebankId(voicebanks[0]!.id);
        }
    }, [voicebanks, selectedVoicebankId]);

    const activeVoicebank = voicebanks.find((v) => v.id === selectedVoicebankId);

    const handleRenderSinging = async (): Promise<void> => {
        const midiState = midiStore.value;
        const notes = midiState?.notesByClipId[clip.id] ?? [];

        if (notes.length === 0) {
            notifyUser('No MIDI notes in this clip to render', 'error');
            return;
        }
        if (!selectedVoicebankId) {
            notifyUser('Select a voicebank first', 'error');
            return;
        }

        setIsRenderingSvs(true);
        setSvsResults([]);
        try {
            const voiceName = activeVoicebank?.name ?? selectedVoicebankId;
            const lyrics = diffSingerLyrics.trim() || 'la la la';
            const lyricsPreview = lyrics.slice(0, 20) + (lyrics.length > 20 ? '…' : '');
            // Sequential — the ONNX worker is single-threaded so parallel
            // calls would serialize anyway, just with noisier logs.
            const results: RenderResult[] = [];
            for (let i = 0; i < SVS_SEED_VARIANTS.length; i++) {
                const result = await renderDiffSingerPhrase({
                    phraseId: `${clip.id}-svs-${VARIANT_LABELS[i]}`,
                    voicebankId: selectedVoicebankId,
                    lyrics,
                    notes,
                    renderQuality: svsRenderQuality,
                    seed: SVS_SEED_VARIANTS[i],
                });
                results.push({
                    audio: result.audio,
                    sampleRate: result.sampleRate,
                    label: VARIANT_LABELS[i]!,
                    name: `${voiceName} · ${lyricsPreview}`,
                });
            }
            setSvsResults(results);
            notifyAiChange('Singing render complete', ['3 alternatives rendered — drag one onto an audio track']);
        } catch (err) {
            notifyUser(err instanceof Error ? err.message : 'Singing render failed', 'error');
        } finally {
            setIsRenderingSvs(false);
        }
    };

    // Label for the Variations button — "Streaming… N chars" during cloud streaming
    // (tokens arrive incrementally), plain "Generating…" for native/webllm (one shot).
    const variationsButtonLabel = isGeneratingVariations
        ? variationTokenCount > 0
            ? `Streaming… ${String(variationTokenCount)} chars`
            : 'Generating…'
        : 'Generate';

    return (
        <section>
            <DawHeaderBand
                compact
                className="mb-2 rounded-sm"
                title="AI Actions"
                startSlot={<Sparkles className="size-3 text-[var(--color-accent-lavender)]" aria-hidden="true" />}
            />

            <div className="space-y-2">
                {/* AI Variations */}
                <DawPluginSectionCard
                    title="AI Variations"
                    detail={<Music className="size-3 text-[var(--color-accent-lavender)]" aria-hidden="true" />}
                    detailMode="badge"
                >
                    <p className="text-[9px] text-muted-foreground leading-relaxed mb-2">
                        Generate 3 musical variations (rhythm, passing notes, simplification). Placed after this clip, muted by default.
                    </p>
                    <Button
                        variant="secondary"
                        size="xs"
                        className="w-full h-6 text-[10px] bg-[var(--color-accent-lavender)]/20 hover:bg-[var(--color-accent-lavender)]/40 text-[var(--color-accent-lavender)]"
                        onClick={handleGenerateVariations}
                        disabled={isGeneratingVariations}
                    >
                        {isGeneratingVariations ? (
                            <>
                                <Loader2 className="size-3 mr-1 animate-spin" aria-hidden="true" />
                                {variationsButtonLabel}
                            </>
                        ) : (
                            <>
                                <Sparkles className="size-3 mr-1" aria-hidden="true" /> Generate
                            </>
                        )}
                    </Button>
                </DawPluginSectionCard>

                {/* Vocals — unified section for Spoken (Kokoro TTS) and Sung (DiffSinger SVS) */}
                {isUnsupported ? null : (
                    <DawPluginSectionCard
                        title="Vocals"
                        detail={<Mic className="size-3 text-[var(--color-accent-peach)]" aria-hidden="true" />}
                        detailMode="badge"
                    >
                        {/* Mode toggle */}
                        <div className="flex gap-1 mb-2">
                            <button
                                type="button"
                                onClick={() => setVocalMode('spoken')}
                                className={`flex-1 h-5 text-[9px] font-medium rounded transition-colors ${
                                    vocalMode === 'spoken'
                                        ? 'bg-[var(--color-accent-peach)]/20 text-[var(--color-accent-peach)]'
                                        : 'bg-surface-overlay/50 text-muted-foreground/60 hover:text-muted-foreground'
                                }`}
                            >
                                Spoken
                            </button>
                            <button
                                type="button"
                                onClick={() => setVocalMode('sung')}
                                className={`flex-1 h-5 text-[9px] font-medium rounded transition-colors ${
                                    vocalMode === 'sung'
                                        ? 'bg-[var(--color-accent-lavender)]/20 text-[var(--color-accent-lavender)]'
                                        : 'bg-surface-overlay/50 text-muted-foreground/60 hover:text-muted-foreground'
                                }`}
                            >
                                Sung
                            </button>
                        </div>

                        {/* ── Spoken mode (Kokoro TTS) ── */}
                        {vocalMode === 'spoken' ? (
                            kokoroStatus === 'downloading' ? (
                                <div className="space-y-1.5">
                                    <p className="text-[9px] text-muted-foreground">Downloading voice model…</p>
                                    <div
                                        className="w-full h-1 bg-border/40 rounded-full overflow-hidden"
                                        role="progressbar"
                                        aria-valuenow={Math.round(kokoroProgress * 100)}
                                        aria-valuemin={0}
                                        aria-valuemax={100}
                                    >
                                        <div
                                            className="h-full bg-[var(--color-accent-peach)] transition-all"
                                            style={{ width: `${Math.round(kokoroProgress * 100)}%` }}
                                        />
                                    </div>
                                    <p className="text-[9px] text-muted-foreground/60 tabular-nums">
                                        {Math.round(kokoroProgress * 100)}%
                                    </p>
                                </div>
                            ) : kokoroStatus !== 'ready' ? (
                                <DawEmptyState
                                    compact
                                    title="Download a voice to get started"
                                    description="Type text and generate a spoken vocal scratch track."
                                    action={
                                        <Button
                                            variant="secondary"
                                            size="xs"
                                            className="h-6 text-[10px] bg-[var(--color-accent-peach)]/20 hover:bg-[var(--color-accent-peach)]/40 text-[var(--color-accent-peach)]"
                                            onClick={handleDownloadKokoro}
                                        >
                                            <Download className="size-3 mr-1" aria-hidden="true" />
                                            Download Voice Model
                                            <DawMicroBadge tone="muted" className="ml-1.5">~86 MB</DawMicroBadge>
                                        </Button>
                                    }
                                />
                            ) : (
                                <div className="space-y-2">
                                    <div className="space-y-1">
                                        <label className="text-[9px] text-muted-foreground/70 uppercase tracking-wider">Text</label>
                                        <DawCompactTextarea
                                            value={ttsText}
                                            onChange={(e) => setTtsText(e.target.value)}
                                            placeholder="Type lyrics or text…"
                                            rows={2}
                                            aria-label="TTS text"
                                        />
                                    </div>
                                    <div className="space-y-1">
                                        <label className="text-[9px] text-muted-foreground/70 uppercase tracking-wider">Voice</label>
                                        <KokoroVoiceSelector value={ttsVoiceId} onChange={setTtsVoiceId} disabled={isRenderingTts} />
                                    </div>
                                    <div className="space-y-1">
                                        <label className="text-[9px] text-muted-foreground/70 uppercase tracking-wider">Speed</label>
                                        <DawCompactSelect value={ttsSpeed} onChange={(e) => setTtsSpeed(e.target.value)} aria-label="Speed" className="w-full">
                                            <option value="0.5">0.5× Slow</option>
                                            <option value="0.75">0.75×</option>
                                            <option value="1.0">1.0× Normal</option>
                                            <option value="1.25">1.25×</option>
                                            <option value="1.5">1.5× Fast</option>
                                            <option value="2.0">2.0× Very fast</option>
                                        </DawCompactSelect>
                                    </div>
                                    <Button
                                        variant="secondary"
                                        size="xs"
                                        className="w-full h-6 text-[10px] bg-[var(--color-accent-peach)]/20 hover:bg-[var(--color-accent-peach)]/40 text-[var(--color-accent-peach)]"
                                        onClick={handlePreviewVoice}
                                        disabled={isRenderingTts || !ttsText.trim()}
                                    >
                                        {isRenderingTts ? (
                                            <><Loader2 className="size-3 mr-1 animate-spin" aria-hidden="true" /> Rendering…</>
                                        ) : (
                                            <><Mic className="size-3 mr-1" aria-hidden="true" /> Render 3 Alternatives</>
                                        )}
                                    </Button>
                                    {ttsResults.length > 0 ? (
                                        <div className="space-y-1 pt-1">
                                            <p className="text-[8px] text-muted-foreground/50 uppercase tracking-wider">Drag onto an audio track</p>
                                            {ttsResults.map((r) => (
                                                <AiRenderClipPreview key={r.label} audio={r.audio} sampleRate={r.sampleRate} label={r.label} name={r.name} />
                                            ))}
                                        </div>
                                    ) : null}
                                </div>
                            )
                        ) : (
                            /* ── Sung mode (DiffSinger SVS) ── */
                            voicebanks.length === 0 ? (
                                <DawEmptyState
                                    compact
                                    title="Singing voices coming soon"
                                    description="AI singing voice synthesis is under development. Use the Spoken mode to generate vocal scratch tracks from text."
                                />
                            ) : (
                                <div className="space-y-2">
                                    <div className="space-y-1">
                                        <label className="text-[9px] text-muted-foreground/70 uppercase tracking-wider">Voice</label>
                                        <DawCompactSelect value={selectedVoicebankId} onChange={(e) => setSelectedVoicebankId(e.target.value)} aria-label="Voicebank" className="w-full">
                                            {voicebanks.map((vb) => (
                                                <option key={vb.id} value={vb.id}>{vb.name}</option>
                                            ))}
                                        </DawCompactSelect>
                                    </div>
                                    <div className="space-y-1">
                                        <label className="text-[9px] text-muted-foreground/70 uppercase tracking-wider">Lyrics</label>
                                        <DawCompactTextarea
                                            value={diffSingerLyrics}
                                            onChange={(e) => setDiffSingerLyrics(e.target.value)}
                                            placeholder="Type lyrics… (leave blank for la la la)"
                                            rows={2}
                                            aria-label="Singing lyrics"
                                        />
                                    </div>
                                    <div className="space-y-1">
                                        <label className="text-[9px] text-muted-foreground/70 uppercase tracking-wider">Quality</label>
                                        <DawCompactSelect
                                            value={svsRenderQuality}
                                            onChange={(e) => {
                                                const opt = QUALITY_OPTIONS.find((o) => o.value === e.target.value);
                                                if (opt) setSvsRenderQuality(opt.value);
                                            }}
                                            aria-label="Render quality"
                                            className="w-full"
                                        >
                                            {QUALITY_OPTIONS.map((opt) => (
                                                <option key={opt.value} value={opt.value}>{opt.label}</option>
                                            ))}
                                        </DawCompactSelect>
                                    </div>

                                    {vocoderStatus === 'downloading' ? (
                                        <div className="space-y-1.5">
                                            <p className="text-[9px] text-muted-foreground">Downloading singing engine…</p>
                                            <div className="w-full h-1 bg-border/40 rounded-full overflow-hidden" role="progressbar" aria-valuenow={Math.round(vocoderProgress * 100)} aria-valuemin={0} aria-valuemax={100}>
                                                <div className="h-full bg-[var(--color-accent-lavender)] transition-all" style={{ width: `${Math.round(vocoderProgress * 100)}%` }} />
                                            </div>
                                            <p className="text-[9px] text-muted-foreground/60 tabular-nums">{Math.round(vocoderProgress * 100)}%</p>
                                        </div>
                                    ) : vocoderStatus !== 'ready' ? (
                                        <div className="space-y-1.5">
                                            <p className="text-[9px] text-muted-foreground/70">
                                                {vocoderStatus === 'error'
                                                    ? 'Download failed — check your connection and try again.'
                                                    : 'A singing engine is also required to render audio.'}
                                            </p>
                                            <Button
                                                variant="secondary"
                                                size="xs"
                                                className="w-full h-6 text-[10px] bg-[var(--color-accent-lavender)]/20 hover:bg-[var(--color-accent-lavender)]/40 text-[var(--color-accent-lavender)]"
                                                onClick={handleDownloadVocoder}
                                            >
                                                <Download className="size-3 mr-1" aria-hidden="true" />
                                                {vocoderStatus === 'error' ? 'Retry Download' : 'Download Singing Engine'}
                                                <DawMicroBadge tone="muted" className="ml-1.5">~52 MB</DawMicroBadge>
                                            </Button>
                                        </div>
                                    ) : (
                                        <>
                                            <Button
                                                variant="secondary"
                                                size="xs"
                                                className="w-full h-6 text-[10px] bg-[var(--color-accent-lavender)]/20 hover:bg-[var(--color-accent-lavender)]/40 text-[var(--color-accent-lavender)]"
                                                onClick={handleRenderSinging}
                                                disabled={isRenderingSvs}
                                            >
                                                {isRenderingSvs ? (
                                                    <><Loader2 className="size-3 mr-1 animate-spin" aria-hidden="true" /> Rendering…</>
                                                ) : (
                                                    <><AudioLines className="size-3 mr-1" aria-hidden="true" /> Render 3 Alternatives</>
                                                )}
                                            </Button>
                                            {svsResults.length > 0 ? (
                                                <div className="space-y-1 pt-1">
                                                    <p className="text-[8px] text-muted-foreground/50 uppercase tracking-wider">Drag onto an audio track</p>
                                                    {svsResults.map((r) => (
                                                        <AiRenderClipPreview key={r.label} audio={r.audio} sampleRate={r.sampleRate} label={r.label} name={r.name} />
                                                    ))}
                                                </div>
                                            ) : null}
                                        </>
                                    )}
                                </div>
                            )
                        )}
                    </DawPluginSectionCard>
                )}

            </div>

        </section>
    );
};
