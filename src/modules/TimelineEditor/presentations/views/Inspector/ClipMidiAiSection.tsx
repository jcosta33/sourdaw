import { type ReactElement, useState, useEffect, useLayoutEffect, useRef } from 'react';

import { Sparkles, Loader2, Music, Mic, AudioLines, Download, Cpu } from 'lucide-react';

import { DawCompactSelect } from '#/components/daw/DawCompactSelect';
import { DawCompactTextarea } from '#/components/daw/DawCompactTextarea';
import { DawEmptyState } from '#/components/daw/DawEmptyState';
import { DawHeaderBand } from '#/components/daw/DawHeaderBand';
import { DawMicroBadge } from '#/components/daw/DawMicroBadge';
import { DawPluginSectionCard } from '#/components/daw/DawPluginSectionCard';
import { Row, Stack } from '#/components/layout';
import { Button } from '#/components/ui/button';
import { useStore } from '#/infra/store/useStore';
import { generateMidiVariations } from '#/modules/AiGeneration/useCases';
import { notifyAiChange } from '#/modules/AiRuntime/useCases';
import { KokoroVoiceSelector, AiRenderClipPreview } from '#/modules/BrowserAi/presentations/views';
import { capabilityStore, modelRegistryStore } from '#/modules/BrowserAi/stores';
import {
    renderKokoroTts,
    renderDiffSingerPhrase,
    downloadModel,
    KOKORO_MODEL_ENTRY,
    getDdspPhraseId,
    invalidateDdspPhraseIfSourceChanged,
    isDdspInstrumentId,
    recordDdspPhraseSource,
    renderDdspInstrument,
} from '#/modules/BrowserAi/useCases';
import { defaultGrooveTemplateState, grooveTemplateStore, type MidiStoreState, midiStore } from '#/modules/MIDI/stores';
import { projectClipMidiEvents } from '#/modules/MIDI/useCases';
import { defaultTransportState, tempoMapStore, transportStore } from '#/modules/Transport/stores';
import { secondsBetweenBeats } from '#/modules/Transport/useCases';
import { openPreferencesDialog } from '#/modules/WorkspaceShell/useCases';
import { projectClipLoopExpansion } from '#/utils/clipLoopProjection';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { type Clip } from '../../../models/TrackViewTypes';

type RenderQuality = 'low' | 'standard' | 'high' | 'maximum';

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

type StillOwnsPanelInput = {
    signal: AbortSignal;
    launchClipId: string;
};

type DdspLaunch = {
    controller: AbortController;
    sourceFingerprint: string;
};

type DdspSourceFingerprintInput = {
    defaultTempo: number;
    durationSec: number;
    instrument: { artifactVersion?: string; id: string } | undefined;
    notes: ReadonlyArray<DdspTimedNote>;
    projection: Pick<Clip, 'endBeat' | 'loopEnabled' | 'loopLength' | 'midiOffsetBeats' | 'startBeat'>;
};

type DdspTimedNote = { durationSec: number; pitch: number; startSec: number; velocity: number };

const EMPTY_MIDI_STATE: MidiStoreState = {
    probabilitySeed: 0,
    notesByClipId: {},
    ccByClipId: {},
    pitchBendByClipId: {},
};

function ddspSourceFingerprint({
    defaultTempo,
    durationSec,
    instrument,
    notes,
    projection,
}: DdspSourceFingerprintInput): string {
    return JSON.stringify([
        instrument?.id ?? null,
        instrument?.artifactVersion ?? null,
        defaultTempo,
        durationSec,
        notes.map(({ pitch, velocity, startSec, durationSec: noteDurationSec }) => [
            pitch,
            velocity,
            startSec,
            noteDurationSec,
        ]),
        projection.startBeat,
        projection.endBeat,
        projection.midiOffsetBeats ?? 0,
        projection.loopEnabled ?? false,
        projection.loopLength ?? null,
    ]);
}

function projectDdspNotes({
    clip,
    defaultTempo,
    notes,
    tempoChanges,
}: {
    clip: Clip;
    defaultTempo: number;
    notes: MidiStoreState['notesByClipId'][string];
    tempoChanges: Parameters<typeof secondsBetweenBeats>[0];
}): DdspTimedNote[] {
    const loopProjection = projectClipLoopExpansion({
        clipDurationBeats: clip.endBeat - clip.startBeat,
        configuredLoopLengthBeats: clip.loopLength,
        loopEnabled: clip.loopEnabled ?? false,
    });
    const midiOffsetBeats = clip.midiOffsetBeats ?? 0;
    const projectedNotes = Array.from({ length: loopProjection.iterationCount }, (_, iterationIndex) => {
        const iterationStartBeat = clip.startBeat + iterationIndex * loopProjection.loopLengthBeats;
        return notes.flatMap((note) =>
            projectClipMidiEvents({
                events: [note],
                clipId: clip.id,
                clipStartBeat: clip.startBeat,
                clipEndBeat: clip.endBeat,
                iterationStartBeat,
                loopLengthBeats: loopProjection.loopLengthBeats,
                midiOffsetBeats,
                loopEnabled: clip.loopEnabled ?? false,
            })
        );
    }).flat();
    return projectedNotes.flatMap((note) => {
        const endBeat = note.startBeat + note.duration;
        if (endBeat <= note.startBeat) {
            return [];
        }
        return [
            {
                pitch: note.pitch,
                velocity: note.velocity,
                startSec: secondsBetweenBeats(tempoChanges, clip.startBeat, note.startBeat, defaultTempo),
                durationSec: secondsBetweenBeats(tempoChanges, note.startBeat, endBeat, defaultTempo),
            },
        ];
    });
}

export const ClipMidiAiSection = ({ clip }: ClipMidiAiSectionProps): ReactElement => {
    const [isGeneratingVariations, setIsGeneratingVariations] = useState(false);
    const [variationTokenCount, setVariationTokenCount] = useState(0);
    const [isRenderingTts, setIsRenderingTts] = useState(false);
    const [isRenderingDdsp, setIsRenderingDdsp] = useState(false);
    const [ddspInstrumentId, setDdspInstrumentId] = useState('');
    const [ddspResult, setDdspResult] = useState<RenderResult | null>(null);
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
    const midiState = useStore(midiStore, EMPTY_MIDI_STATE);
    useStore(grooveTemplateStore, defaultGrooveTemplateState);
    const tempoMapState = useStore(tempoMapStore, { changes: [] });
    const transportState = useStore(transportStore, defaultTransportState);

    const capability = capState?.phase === 'done' ? capState.report.capability : null;
    const isUnsupported = capability === 'unsupported-browser';

    const kokoroStatus = registry?.kokoroModel?.status ?? 'not-downloaded';
    const kokoroProgress = registry?.kokoroModel?.downloadProgress ?? 0;
    const vocoderStatus = registry?.vocoder?.status ?? 'not-downloaded';
    const vocoderProgress = registry?.vocoder?.downloadProgress ?? 0;
    const readyDdspInstruments = registry?.ddspInstruments.filter((instrument) => instrument.status === 'ready') ?? [];
    const selectedDdspInstrument =
        readyDdspInstruments.find((instrument) => instrument.id === ddspInstrumentId) ?? readyDdspInstruments[0];
    const ddspNotes = midiState.notesByClipId[clip.id] ?? [];
    const ddspDurationSec = secondsBetweenBeats(
        tempoMapState.changes,
        clip.startBeat,
        clip.endBeat,
        transportState.tempo
    );
    const projectedDdspNotes = projectDdspNotes({
        clip,
        defaultTempo: transportState.tempo,
        notes: ddspNotes,
        tempoChanges: tempoMapState.changes,
    });
    const currentDdspSourceFingerprint = ddspSourceFingerprint({
        defaultTempo: transportState.tempo,
        durationSec: ddspDurationSec,
        instrument: selectedDdspInstrument,
        notes: projectedDdspNotes,
        projection: clip,
    });

    // Every AI action here runs for seconds while the panel stays interactive, so each one has
    // to prove it still owns the panel before writing anything back (audit M-250). Two
    // independent ways to lose that ownership, and both are live:
    //
    //   identity — the panel moved to a different clip. Compared at resolution time rather than
    //     invalidated on switch, because the switch is only observable during render, where
    //     mutating a ref is unsafe (concurrent rendering can discard a render) and calling
    //     abort() is a side effect. A comparison has no such window and needs no bookkeeping.
    //   supersession — a newer launch for the SAME clip replaced this one. Identity cannot see
    //     that, so each launch owns an AbortController which the next launch aborts, entirely
    //     inside event handlers. This is reachable: the render-time reset below clears the
    //     `isGenerating…` / `isRendering…` flags on every clip change, so one A→B→A round trip
    //     re-enables a button whose first job is still in flight.
    const renderedClipIdRef = useRef(clip.id);
    const variationsLaunchRef = useRef<AbortController | null>(null);
    const ddspLaunchRef = useRef<DdspLaunch | null>(null);
    const ttsLaunchRef = useRef<AbortController | null>(null);
    const svsLaunchRef = useRef<AbortController | null>(null);

    useEffect(() => {
        setDdspInstrumentId(selectedDdspInstrument?.id ?? '');
    }, [selectedDdspInstrument?.id]);

    useLayoutEffect(
        () => () => {
            const activeDdspLaunch = ddspLaunchRef.current;
            ddspLaunchRef.current = null;
            activeDdspLaunch?.controller.abort();
        },
        [clip.id]
    );

    const committedDdspSourceRef = useRef({
        clipId: clip.id,
        fingerprint: currentDdspSourceFingerprint,
    });

    useLayoutEffect(() => {
        const previous = committedDdspSourceRef.current;
        committedDdspSourceRef.current = { clipId: clip.id, fingerprint: currentDdspSourceFingerprint };
        const sourceChanged = previous.clipId === clip.id && previous.fingerprint !== currentDdspSourceFingerprint;
        const invalidated = invalidateDdspPhraseIfSourceChanged(clip.id, currentDdspSourceFingerprint);
        if (sourceChanged) {
            const activeLaunch = ddspLaunchRef.current;
            if (activeLaunch !== null) {
                ddspLaunchRef.current = null;
                activeLaunch.controller.abort();
                setIsRenderingDdsp(false);
            }
        }
        if (sourceChanged || invalidated) {
            setDdspResult(null);
        }
    }, [clip.id, currentDdspSourceFingerprint]);

    const stillOwnsPanel = ({ signal, launchClipId }: StillOwnsPanelInput): boolean => {
        if (signal.aborted) {
            return false;
        }
        return renderedClipIdRef.current === launchClipId;
    };

    const stillOwnsDdspLaunch = (launch: DdspLaunch, launchClipId: string): boolean => {
        return (
            ddspLaunchRef.current === launch &&
            committedDdspSourceRef.current.fingerprint === launch.sourceFingerprint &&
            stillOwnsPanel({ signal: launch.controller.signal, launchClipId })
        );
    };

    const handleGenerateVariations = async (): Promise<void> => {
        setIsGeneratingVariations(true);
        setVariationTokenCount(0);
        variationsLaunchRef.current?.abort();
        const launch = new AbortController();
        variationsLaunchRef.current = launch;
        const { signal } = launch;
        const launchClipId = clip.id;
        try {
            const count = await generateMidiVariations(launchClipId, {
                onToken: (token) => {
                    if (!stillOwnsPanel({ signal, launchClipId })) {
                        // Streamed progress belonging to a clip the panel has left, or to a
                        // launch a newer one replaced. Counting it would inflate the live
                        // "Streaming… N chars" readout of whatever is running now (audit M-250).
                        return;
                    }
                    setVariationTokenCount((context) => context + token.length);
                },
            });
            if (!stillOwnsPanel({ signal, launchClipId })) {
                // Announcing here would credit this clip's variations to whichever clip the
                // panel is showing now (audit M-250).
                return;
            }
            notifyAiChange('MIDI variations generated', [
                `${String(count)} variation${count === 1 ? '' : 's'} created as alternative clips`,
            ]);
        } catch (error) {
            if (!stillOwnsPanel({ signal, launchClipId })) {
                // A failure that belongs to a clip the user has already left, or to a
                // superseded launch. Reporting it would raise a toast about work they can no
                // longer see (audit M-250).
                return;
            }
            notifyUser(error instanceof Error ? error.message : 'Variation generation failed', 'error');
        } finally {
            if (stillOwnsPanel({ signal, launchClipId })) {
                // Only the launch that still owns the panel may clear its spinner. An abandoned
                // launch would otherwise stop the spinner of the job running right now.
                setIsGeneratingVariations(false);
            }
        }
    };

    // Re-point the panel at the newly selected clip and drop the previous clip's scratch state.
    // Note this also clears the in-flight flags, which is what makes same-clip supersession
    // reachable — see the launch-ownership comment above.
    if (renderedClipIdRef.current !== clip.id) {
        renderedClipIdRef.current = clip.id;
        setTtsText('');
        setDiffSingerLyrics('');
        setTtsVoiceId('af_heart');
        setTtsSpeed('1.0');
        setVariationTokenCount(0);
        setIsGeneratingVariations(false);
        setIsRenderingTts(false);
        setIsRenderingDdsp(false);
        setIsRenderingSvs(false);
        setDdspResult(null);
        setTtsResults([]);
        setSvsResults([]);
    }

    const handleDownloadKokoro = (): void => {
        void downloadModel({
            modelId: KOKORO_MODEL_ENTRY.id,
            family: KOKORO_MODEL_ENTRY.family,
            url: KOKORO_MODEL_ENTRY.url,
            sizeBytes: KOKORO_MODEL_ENTRY.sizeBytes,
            sha256: KOKORO_MODEL_ENTRY.sha256,
        });
    };

    const handleRenderDdsp = async (): Promise<void> => {
        const instrument = selectedDdspInstrument;
        if (!instrument) {
            notifyUser('Download a DDSP instrument in AI Model Manager first', 'error');
            return;
        }
        const instrumentId = instrument.id;
        if (!isDdspInstrumentId(instrumentId)) {
            notifyUser('The selected DDSP instrument is not admitted in this release', 'error');
            return;
        }

        if (projectedDdspNotes.length === 0) {
            notifyUser('No MIDI notes in this clip to render', 'error');
            return;
        }

        setIsRenderingDdsp(true);
        setDdspResult(null);
        ddspLaunchRef.current?.controller.abort();
        const launch: DdspLaunch = {
            controller: new AbortController(),
            sourceFingerprint: currentDdspSourceFingerprint,
        };
        ddspLaunchRef.current = launch;
        const launchClipId = clip.id;
        try {
            const result = await renderDdspInstrument({
                phraseId: getDdspPhraseId(clip.id),
                instrumentId,
                notes: projectedDdspNotes,
                durationSec: ddspDurationSec,
                signal: launch.controller.signal,
            });
            if (!stillOwnsDdspLaunch(launch, launchClipId)) {
                return;
            }
            setDdspResult({ audio: result.audio, sampleRate: result.sampleRate, label: 'DDSP', name: instrument.name });
            recordDdspPhraseSource(clip.id, launch.sourceFingerprint);
            notifyAiChange('Instrument render complete', [`${instrument.name} rendered — drag it onto an audio track`]);
        } catch (error) {
            if (!stillOwnsDdspLaunch(launch, launchClipId) || (error instanceof Error && error.name === 'AbortError')) {
                return;
            }
            notifyUser(error instanceof Error ? error.message : 'DDSP render failed', 'error');
        } finally {
            if (ddspLaunchRef.current === launch) {
                ddspLaunchRef.current = null;
                setIsRenderingDdsp(false);
            }
        }
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
        ttsLaunchRef.current?.abort();
        const launch = new AbortController();
        ttsLaunchRef.current = launch;
        const { signal } = launch;
        const launchClipId = clip.id;
        try {
            // Sequential — the ONNX worker is single-threaded so parallel
            // calls would serialize anyway, just with noisier logs.
            const results: RenderResult[] = [];
            const textPreview = ttsText.trim().slice(0, 20) + (ttsText.trim().length > 20 ? '…' : '');
            for (let index = 0; index < TTS_SPEED_VARIANTS.length; index++) {
                const speed = baseSpeed * TTS_SPEED_VARIANTS[index]!;
                const result = await renderKokoroTts({
                    phraseId: `${clip.id}-tts-${VARIANT_LABELS[index]}`,
                    text: ttsText.trim(),
                    speakerId: ttsVoiceId,
                    speed,
                    targetDurationSec,
                });
                if (!stillOwnsPanel({ signal, launchClipId })) {
                    // The panel moved to another clip, or a newer launch replaced this
                    // one, while this variant was rendering. Drop it and stop queueing the
                    // remaining variants (audit M-250).
                    return;
                }
                results.push({
                    audio: result.audio,
                    sampleRate: result.sampleRate,
                    label: VARIANT_LABELS[index]!,
                    name: `${ttsVoiceId} · ${textPreview}`,
                });
            }
            setTtsResults(results);
            notifyAiChange('Vocal preview ready', ['3 alternatives rendered — drag one onto an audio track']);
        } catch (error) {
            if (!stillOwnsPanel({ signal, launchClipId })) {
                // A failure that belongs to a clip the user has already left, or to a
                // superseded launch. Reporting it would raise an error toast about work they
                // can no longer see (audit M-250).
                return;
            }
            notifyUser(error instanceof Error ? error.message : 'TTS render failed', 'error');
        } finally {
            if (stillOwnsPanel({ signal, launchClipId })) {
                // Only the launch that still owns the panel may clear its spinner. An
                // abandoned launch would otherwise stop the spinner of the render running now.
                setIsRenderingTts(false);
            }
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
        const isValid = voicebanks.some((value) => value.id === selectedVoicebankId);
        if (!isValid) {
            setSelectedVoicebankId(voicebanks[0]!.id);
        }
    }, [voicebanks, selectedVoicebankId]);

    const activeVoicebank = voicebanks.find((value) => value.id === selectedVoicebankId);

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
        svsLaunchRef.current?.abort();
        const launch = new AbortController();
        svsLaunchRef.current = launch;
        const { signal } = launch;
        const launchClipId = clip.id;
        try {
            const voiceName = activeVoicebank?.name ?? selectedVoicebankId;
            const lyrics = diffSingerLyrics.trim() || 'la la la';
            const lyricsPreview = lyrics.slice(0, 20) + (lyrics.length > 20 ? '…' : '');
            const tempo = tempoMapStore.value?.changes[0]?.tempo ?? 120;
            const secondsPerBeat = 60 / tempo;
            const timedNotes = notes.map((note) => ({
                pitch: note.pitch,
                velocity: note.velocity,
                startSec: note.startBeat * secondsPerBeat,
                durationSec: note.duration * secondsPerBeat,
            }));
            // Sequential — the ONNX worker is single-threaded so parallel
            // calls would serialize anyway, just with noisier logs.
            const results: RenderResult[] = [];
            for (let index = 0; index < SVS_SEED_VARIANTS.length; index++) {
                const rawResult: unknown = await renderDiffSingerPhrase({
                    phraseId: `${clip.id}-svs-${VARIANT_LABELS[index]}`,
                    voicebankId: selectedVoicebankId,
                    lyrics,
                    notes: timedNotes,
                    renderQuality: svsRenderQuality,
                    seed: SVS_SEED_VARIANTS[index],
                });

                if (!stillOwnsPanel({ signal, launchClipId })) {
                    // The panel moved to another clip, or a newer launch replaced this
                    // one, while this variant was rendering. Drop it and stop queueing the
                    // remaining variants (audit M-250).
                    return;
                }

                if (
                    !rawResult ||
                    typeof rawResult !== 'object' ||
                    !('audio' in rawResult) ||
                    !('sampleRate' in rawResult) ||
                    !(rawResult.audio instanceof Float32Array) ||
                    typeof rawResult.sampleRate !== 'number'
                ) {
                    throw new Error('Invalid output from rendering engine');
                }

                results.push({
                    audio: rawResult.audio,
                    sampleRate: rawResult.sampleRate,
                    label: VARIANT_LABELS[index]!,
                    name: `${voiceName} · ${lyricsPreview}`,
                });
            }
            setSvsResults(results);
            notifyAiChange('Singing render complete', ['3 alternatives rendered — drag one onto an audio track']);
        } catch (error) {
            if (!stillOwnsPanel({ signal, launchClipId })) {
                // A failure that belongs to a clip the user has already left, or to a
                // superseded launch. Reporting it would raise an error toast about work they
                // can no longer see (audit M-250).
                return;
            }
            notifyUser(error instanceof Error ? error.message : 'Singing render failed', 'error');
        } finally {
            if (stillOwnsPanel({ signal, launchClipId })) {
                // Only the launch that still owns the panel may clear its spinner. An
                // abandoned launch would otherwise stop the spinner of the render running now.
                setIsRenderingSvs(false);
            }
        }
    };

    // Label for the Variations button — "Streaming… N chars" during cloud streaming
    // (tokens arrive incrementally), plain "Generating…" for browser-local one-shot work.
    const variationsButtonLabel = (() => {
        if (!isGeneratingVariations) {
            return 'Generate';
        }
        if (variationTokenCount > 0) {
            return `Streaming… ${String(variationTokenCount)} chars`;
        }
        return 'Generating…';
    })();
    const renderIife_12 = () => {
        if (isUnsupported) {
            return null;
        } else {
            const renderIife_13 = () => {
                if (vocalMode === 'spoken') {
                    return (() => {
                        if (kokoroStatus === 'downloading') {
                            return (
                                <Stack gap={1.5}>
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
                                            style={{
                                                width: `${Math.round(kokoroProgress * 100)}%`,
                                            }}
                                        />
                                    </div>
                                    <p className="text-[9px] text-muted-foreground/60 tabular-nums">
                                        {Math.round(kokoroProgress * 100)}%
                                    </p>
                                </Stack>
                            );
                        } else {
                            if (kokoroStatus !== 'ready') {
                                return (
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
                                                <DawMicroBadge tone="muted" className="ml-1.5">
                                                    ~86 MB
                                                </DawMicroBadge>
                                            </Button>
                                        }
                                    />
                                );
                            } else {
                                return (
                                    <Stack gap={2}>
                                        <Stack gap={1}>
                                            <label className="text-[9px] text-muted-foreground/70 uppercase tracking-wider">
                                                Text
                                            </label>
                                            <DawCompactTextarea
                                                value={ttsText}
                                                onChange={(event) => setTtsText(event.target.value)}
                                                placeholder="Type lyrics or text…"
                                                rows={2}
                                                aria-label="TTS text"
                                            />
                                        </Stack>
                                        <Stack gap={1}>
                                            <label className="text-[9px] text-muted-foreground/70 uppercase tracking-wider">
                                                Voice
                                            </label>
                                            <KokoroVoiceSelector
                                                value={ttsVoiceId}
                                                onChange={setTtsVoiceId}
                                                disabled={isRenderingTts}
                                            />
                                        </Stack>
                                        <Stack gap={1}>
                                            <label className="text-[9px] text-muted-foreground/70 uppercase tracking-wider">
                                                Speed
                                            </label>
                                            <DawCompactSelect
                                                value={ttsSpeed}
                                                onChange={(event) => setTtsSpeed(event.target.value)}
                                                aria-label="Speed"
                                                className="w-full"
                                            >
                                                <option value="0.5">0.5× Slow</option>
                                                <option value="0.75">0.75×</option>
                                                <option value="1.0">1.0× Normal</option>
                                                <option value="1.25">1.25×</option>
                                                <option value="1.5">1.5× Fast</option>
                                                <option value="2.0">2.0× Very fast</option>
                                            </DawCompactSelect>
                                        </Stack>
                                        <Button
                                            variant="secondary"
                                            size="xs"
                                            className="w-full h-6 text-[10px] bg-[var(--color-accent-peach)]/20 hover:bg-[var(--color-accent-peach)]/40 text-[var(--color-accent-peach)]"
                                            onClick={handlePreviewVoice}
                                            disabled={isRenderingTts || !ttsText.trim()}
                                        >
                                            {isRenderingTts ? (
                                                <>
                                                    <Loader2 className="size-3 mr-1 animate-spin" aria-hidden="true" />{' '}
                                                    Rendering…
                                                </>
                                            ) : (
                                                <>
                                                    <Mic className="size-3 mr-1" aria-hidden="true" /> Render 3
                                                    Alternatives
                                                </>
                                            )}
                                        </Button>
                                        {ttsResults.length > 0 ? (
                                            <Stack gap={1} className="pt-1">
                                                <p className="text-[8px] text-muted-foreground/50 uppercase tracking-wider">
                                                    Drag onto an audio track
                                                </p>
                                                {ttsResults.map((r) => (
                                                    <AiRenderClipPreview
                                                        key={r.label}
                                                        audio={r.audio}
                                                        sampleRate={r.sampleRate}
                                                        label={r.label}
                                                        name={r.name}
                                                    />
                                                ))}
                                            </Stack>
                                        ) : null}
                                    </Stack>
                                );
                            }
                        }
                    })();
                } else {
                    if (voicebanks.length === 0) {
                        return (
                            <DawEmptyState
                                compact
                                title="No singing voices downloaded"
                                description="Download a singing voice to render your MIDI notes as vocals."
                                action={
                                    <Button
                                        variant="secondary"
                                        size="xs"
                                        className="h-6 text-[10px] bg-[var(--color-accent-lavender)]/20 hover:bg-[var(--color-accent-lavender)]/40 text-[var(--color-accent-lavender)]"
                                        onClick={openPreferencesDialog}
                                    >
                                        <Download className="size-3 mr-1" aria-hidden="true" />
                                        Browse Singing Voices
                                        <DawMicroBadge tone="muted" className="ml-1.5">
                                            ~150 MB each
                                        </DawMicroBadge>
                                    </Button>
                                }
                            />
                        );
                    } else {
                        const renderIife_14 = () => {
                            if (vocoderStatus === 'downloading') {
                                return (
                                    <Stack gap={1.5}>
                                        <p className="text-[9px] text-muted-foreground">Downloading singing engine…</p>
                                        <div
                                            className="w-full h-1 bg-border/40 rounded-full overflow-hidden"
                                            role="progressbar"
                                            aria-valuenow={Math.round(vocoderProgress * 100)}
                                            aria-valuemin={0}
                                            aria-valuemax={100}
                                        >
                                            <div
                                                className="h-full bg-[var(--color-accent-lavender)] transition-all"
                                                style={{
                                                    width: `${Math.round(vocoderProgress * 100)}%`,
                                                }}
                                            />
                                        </div>
                                        <p className="text-[9px] text-muted-foreground/60 tabular-nums">
                                            {Math.round(vocoderProgress * 100)}%
                                        </p>
                                    </Stack>
                                );
                            } else {
                                if (vocoderStatus !== 'ready') {
                                    return (
                                        <Stack gap={1.5}>
                                            <p className="text-[9px] text-muted-foreground/70">
                                                {vocoderStatus === 'error'
                                                    ? 'Download failed — check your connection and try again.'
                                                    : 'A singing engine is also required to render audio.'}
                                            </p>
                                            <DawMicroBadge tone="muted">Unavailable</DawMicroBadge>
                                        </Stack>
                                    );
                                } else {
                                    return (
                                        <>
                                            <Button
                                                variant="secondary"
                                                size="xs"
                                                className="w-full h-6 text-[10px] bg-[var(--color-accent-lavender)]/20 hover:bg-[var(--color-accent-lavender)]/40 text-[var(--color-accent-lavender)]"
                                                onClick={handleRenderSinging}
                                                disabled={isRenderingSvs}
                                            >
                                                {isRenderingSvs ? (
                                                    <>
                                                        <Loader2
                                                            className="size-3 mr-1 animate-spin"
                                                            aria-hidden="true"
                                                        />{' '}
                                                        Rendering…
                                                    </>
                                                ) : (
                                                    <>
                                                        <AudioLines className="size-3 mr-1" aria-hidden="true" /> Render
                                                        3 Alternatives
                                                    </>
                                                )}
                                            </Button>
                                            {svsResults.length > 0 ? (
                                                <Stack gap={1} className="pt-1">
                                                    <p className="text-[8px] text-muted-foreground/50 uppercase tracking-wider">
                                                        Drag onto an audio track
                                                    </p>
                                                    {svsResults.map((r) => (
                                                        <AiRenderClipPreview
                                                            key={r.label}
                                                            audio={r.audio}
                                                            sampleRate={r.sampleRate}
                                                            label={r.label}
                                                            name={r.name}
                                                        />
                                                    ))}
                                                </Stack>
                                            ) : null}
                                        </>
                                    );
                                }
                            }
                        };

                        return (
                            <Stack gap={2}>
                                <Stack gap={1}>
                                    <label className="text-[9px] text-muted-foreground/70 uppercase tracking-wider">
                                        Voice
                                    </label>
                                    <DawCompactSelect
                                        value={selectedVoicebankId}
                                        onChange={(event) => setSelectedVoicebankId(event.target.value)}
                                        aria-label="Voicebank"
                                        className="w-full"
                                    >
                                        {voicebanks.map((vb) => (
                                            <option key={vb.id} value={vb.id}>
                                                {vb.name}
                                            </option>
                                        ))}
                                    </DawCompactSelect>
                                </Stack>
                                <Stack gap={1}>
                                    <label className="text-[9px] text-muted-foreground/70 uppercase tracking-wider">
                                        Lyrics
                                    </label>
                                    <DawCompactTextarea
                                        value={diffSingerLyrics}
                                        onChange={(event) => setDiffSingerLyrics(event.target.value)}
                                        placeholder="Type lyrics… (leave blank for la la la)"
                                        rows={2}
                                        aria-label="Singing lyrics"
                                    />
                                </Stack>
                                <Stack gap={1}>
                                    <label className="text-[9px] text-muted-foreground/70 uppercase tracking-wider">
                                        Quality
                                    </label>
                                    <DawCompactSelect
                                        value={svsRenderQuality}
                                        onChange={(event) => {
                                            const opt = QUALITY_OPTIONS.find(
                                                (output) => output.value === event.target.value
                                            );
                                            if (opt) {
                                                setSvsRenderQuality(opt.value);
                                            }
                                        }}
                                        aria-label="Render quality"
                                        className="w-full"
                                    >
                                        {QUALITY_OPTIONS.map((opt) => (
                                            <option key={opt.value} value={opt.value}>
                                                {opt.label}
                                            </option>
                                        ))}
                                    </DawCompactSelect>
                                </Stack>
                                {renderIife_14()}
                            </Stack>
                        );
                    }
                }
            };

            return (
                <DawPluginSectionCard
                    title="Vocals"
                    detail={<Mic className="size-3 text-[var(--color-accent-peach)]" aria-hidden="true" />}
                    detailMode="badge"
                >
                    {/* Mode toggle */}
                    <Row align="stretch" gap={1} className="mb-2">
                        <Button
                            variant="bare"
                            size="bare"
                            type="button"
                            onClick={() => setVocalMode('spoken')}
                            className={`flex-1 h-5 text-[9px] font-medium rounded transition-colors ${
                                vocalMode === 'spoken'
                                    ? 'bg-[var(--color-accent-peach)]/20 text-[var(--color-accent-peach)]'
                                    : 'bg-surface-overlay/50 text-muted-foreground/60 hover:text-muted-foreground'
                            }`}
                        >
                            Spoken
                        </Button>
                        <Button
                            variant="bare"
                            size="bare"
                            type="button"
                            disabled
                            className="flex-1 h-5 text-[9px] font-medium rounded bg-surface-overlay/30 text-muted-foreground/40"
                            title="Singing synthesis requires an admitted vocoder"
                        >
                            Sung unavailable
                        </Button>
                    </Row>
                    {/* ── Spoken mode (Kokoro TTS) ── */}
                    {renderIife_13()}
                </DawPluginSectionCard>
            );
        }
    };

    return (
        <section>
            <DawHeaderBand
                compact
                className="mb-2 rounded-sm"
                title="AI Actions"
                startSlot={<Sparkles className="size-3 text-[var(--color-accent-lavender)]" aria-hidden="true" />}
            />
            <Stack gap={2}>
                {/* AI Variations */}
                <DawPluginSectionCard
                    title="AI Variations"
                    detail={<Music className="size-3 text-[var(--color-accent-lavender)]" aria-hidden="true" />}
                    detailMode="badge"
                >
                    <p className="text-[9px] text-muted-foreground leading-relaxed mb-2">
                        Generate 3 musical variations (rhythm, passing notes, simplification). Placed after this clip,
                        muted by default.
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

                {isUnsupported ? null : (
                    <DawPluginSectionCard
                        title="Instrument"
                        detail={<Cpu className="size-3 text-[var(--color-accent-cyan)]" aria-hidden="true" />}
                        detailMode="badge"
                    >
                        {readyDdspInstruments.length === 0 ? (
                            <DawEmptyState
                                compact
                                title="Download an instrument to get started"
                                description="Get a DDSP instrument from AI Model Manager to render this MIDI clip."
                                action={
                                    <Button
                                        variant="secondary"
                                        size="xs"
                                        className="h-6 text-[10px] bg-[var(--color-accent-cyan)]/20 hover:bg-[var(--color-accent-cyan)]/40 text-[var(--color-accent-cyan)]"
                                        onClick={openPreferencesDialog}
                                    >
                                        <Download className="size-3 mr-1" aria-hidden="true" />
                                        Browse Instruments
                                    </Button>
                                }
                            />
                        ) : (
                            <Stack gap={2}>
                                <DawCompactSelect
                                    value={selectedDdspInstrument?.id ?? ''}
                                    onChange={(event) => setDdspInstrumentId(event.target.value)}
                                    aria-label="DDSP instrument"
                                    className="w-full"
                                >
                                    {readyDdspInstruments.map((instrument) => (
                                        <option key={instrument.id} value={instrument.id}>
                                            {instrument.name}
                                        </option>
                                    ))}
                                </DawCompactSelect>
                                <Button
                                    variant="secondary"
                                    size="xs"
                                    className="w-full h-6 text-[10px] bg-[var(--color-accent-cyan)]/20 hover:bg-[var(--color-accent-cyan)]/40 text-[var(--color-accent-cyan)]"
                                    onClick={handleRenderDdsp}
                                    disabled={isRenderingDdsp}
                                >
                                    {isRenderingDdsp ? (
                                        <>
                                            <Loader2 className="size-3 mr-1 animate-spin" aria-hidden="true" />{' '}
                                            Rendering…
                                        </>
                                    ) : (
                                        <>
                                            <Cpu className="size-3 mr-1" aria-hidden="true" /> Render Instrument
                                        </>
                                    )}
                                </Button>
                                {ddspResult ? (
                                    <AiRenderClipPreview
                                        audio={ddspResult.audio}
                                        sampleRate={ddspResult.sampleRate}
                                        label={ddspResult.label}
                                        name={ddspResult.name}
                                    />
                                ) : null}
                            </Stack>
                        )}
                    </DawPluginSectionCard>
                )}

                {/* Vocals — unified section for Spoken (Kokoro TTS) and Sung (DiffSinger SVS) */}
                {renderIife_12()}
            </Stack>
        </section>
    );
};
