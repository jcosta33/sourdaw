import { type ReactElement, useEffect, useState, useRef } from 'react';

import { Flame, X, CheckCircle2 } from 'lucide-react';

import { DawCompactCheckbox } from '#/components/daw/DawCompactCheckbox';
import { DawCompactSelect } from '#/components/daw/DawCompactSelect';
import { DawDialogBody } from '#/components/daw/DawDialogBody';
import { DawDialogFooter } from '#/components/daw/DawDialogFooter';
import { DawDialogSection } from '#/components/daw/DawDialogSection';
import { DawEyebrowLabel } from '#/components/daw/DawEyebrowLabel';
import { Grid, Row, Stack } from '#/components/layout';
import { Button } from '#/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '#/components/ui/dialog';
import { Input } from '#/components/ui/input';
import { logger } from '#/infra/logger/appLogger';
import { useStore } from '#/infra/store/useStore';
import {
    clipSelectionStore,
    defaultClipSelectionState,
    defaultTrackState,
    trackStore,
    type Track,
} from '#/modules/Arrangement/stores';
import { getPluginById } from '#/modules/Arrangement/useCases';
import {
    cancelExport,
    exportStems,
    getAudioContext,
    getAutoDetectedTailSeconds,
    isExportActive,
    renderOffline,
    restoreCachedAudioBuffersFromIdb,
} from '#/modules/AudioEngine/useCases';
import { automationStore, type AutomationLane } from '#/modules/Automation/stores';
import { defaultMidiStoreState, midiStore } from '#/modules/MIDI/stores';
import { isNativeProjectRuntimeAvailable } from '#/modules/Project/useCases';
import { listToasterPatternsOutsideArrangement } from '#/modules/Toaster/useCases';
import { transportStore, defaultTransportState } from '#/modules/Transport/stores';
import { defaultWorkspaceState, workspaceStore, type WorkspaceState } from '#/modules/WorkspaceShell/stores';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { type audioBufferToMp3 as encodeMp3 } from '../../useCases/audioBufferToMp3';
import { selectNativeAudioExportDirectory } from '../../useCases/audioExport/selectNativeAudioExportDirectory';
import { selectNativeAudioExportFile } from '../../useCases/audioExport/selectNativeAudioExportFile';
import { streamExport } from '../../useCases/audioExport/streamExport';
import { renderToClip } from '../../useCases/renderToClip';
import { validatePodcastMetadata } from '../../useCases/validatePodcastMetadata';

import { PODCAST_RSS_MP3_PRESET } from './deliveryPresets';
import { deriveStemFileBaseNames } from './deriveStemFileBaseNames';
import {
    EXPORT_SAMPLE_RATES,
    loadExportSettings,
    MAX_MANUAL_TAIL_SECONDS,
    MIN_EXPORT_TARGET_LUFS,
    MAX_EXPORT_TARGET_LUFS,
    R128_CEILING_DB_TP,
    R128_TARGET_LUFS,
    saveExportSettings,
    type ExportDither,
    type ExportFormat,
    type ExportNormalization,
    type Mp3BitRate,
} from './exportSettings';
import { resolveExportBitDepths } from './resolveExportBitDepths';
import { resolveExportDither } from './resolveExportDither';

type ExportMode = 'mixdown' | 'stems' | 'render-to-clip';
type ExportRange = 'project' | 'loop' | 'marquee';
type TailDetectionSnapshot = {
    tracks: readonly Track[];
    soloMode: WorkspaceState['soloMode'];
    automationLanes: readonly AutomationLane[];
};

const DEFAULT_EXPORT_TAIL_SECONDS = 2;

type ExportDialogProps = {
    open: boolean;
    onClose: () => void;
};

const resolveExportMime = (isZip: boolean, primaryExt: string): string => {
    if (isZip) {
        return 'application/zip';
    }
    if (primaryExt === 'wav') {
        return 'audio/wav';
    }
    if (primaryExt === 'flac') {
        return 'audio/flac';
    }
    return 'audio/mpeg';
};

/**
 * Shows the auto-detected tail, and says when the ceiling decided it.
 *
 * A clamped 60.00 s is indistinguishable from a computed 60.00 s otherwise, and
 * the difference matters: clamped means the render is shorter than the project
 * actually needs, so the export gets cut.
 */
const DetectedTailLabel = ({
    detected,
    minimumSeconds,
}: {
    detected: { seconds: number; clamped: boolean };
    minimumSeconds: number;
}): ReactElement => {
    if (detected.clamped) {
        return (
            <span className="text-[10px] text-amber-400">
                capped at {detected.seconds.toFixed(2)}s — this project needs a longer tail than one export can reserve,
                so it will be cut short
            </span>
        );
    }

    if (detected.seconds < minimumSeconds) {
        return (
            <span className="text-[10px] text-orange-400/70">
                {minimumSeconds.toFixed(2)}s minimum ({detected.seconds.toFixed(2)}s detected)
            </span>
        );
    }

    return <span className="text-[10px] text-orange-400/70">{detected.seconds.toFixed(2)}s detected</span>;
};

const AutoDetectedTailLabel = ({
    honorMuted,
    tracks,
    soloMode,
    automationLanes,
}: {
    honorMuted: boolean;
    tracks: readonly Track[];
    soloMode: WorkspaceState['soloMode'];
    automationLanes: readonly AutomationLane[];
}): ReactElement => {
    const detected = getAutoDetectedTailSeconds({
        tailForDeviceType: (deviceType) => getPluginById(deviceType)?.tail,
        honorMuted,
        tracks,
        soloMode,
        automationLanes,
    });
    return <DetectedTailLabel detected={detected} minimumSeconds={DEFAULT_EXPORT_TAIL_SECONDS} />;
};

export const ExportDialog = ({ open, onClose }: ExportDialogProps): ReactElement => {
    const defaults = loadExportSettings();
    const transport = useStore(transportStore, defaultTransportState);
    const clipSelection = useStore(clipSelectionStore, defaultClipSelectionState);
    const tracksState = useStore(trackStore, defaultTrackState);
    const workspace = useStore(workspaceStore, defaultWorkspaceState);
    const automation = useStore(automationStore, { lanes: [] });
    const midi = useStore(midiStore, defaultMidiStoreState);
    const [formats, setFormats] = useState<Set<ExportFormat>>(() => new Set(defaults.formats));
    const [mode, setMode] = useState<ExportMode>('mixdown');
    const [range, setRange] = useState<ExportRange>('project');
    const [tailSeconds, setTailSeconds] = useState(DEFAULT_EXPORT_TAIL_SECONDS);
    const [autoTail, setAutoTail] = useState(true);
    const [renderTargetTrackId, setRenderTargetTrackId] = useState<string>('new');
    const [sampleRate, setSampleRate] = useState(defaults.sampleRate);
    const [bitDepth, setBitDepth] = useState(defaults.bitDepth);
    const [mp3BitRate, setMp3BitRate] = useState<Mp3BitRate>(defaults.mp3BitRate);
    const [dither, setDither] = useState<ExportDither>(defaults.dither);
    const [normalization, setNormalization] = useState<ExportNormalization>(defaults.normalization);
    const [targetLufs, setTargetLufs] = useState(defaults.targetLufs ?? R128_TARGET_LUFS);
    const [deliveryPreset, setDeliveryPreset] = useState('custom');
    const [podcastMetadata, setPodcastMetadata] = useState({ title: '', artist: '', description: '' });
    const [exporting, setExporting] = useState(false);
    const [progress, setProgress] = useState(0);
    const [statusText, setStatusText] = useState('');
    const [errorText, setErrorText] = useState('');
    // The success auto-close timers must belong to the export session that armed
    // them: the props each timer closes over come from the render that started
    // the export — `open` always true — so a user closing and reopening within
    // the timer window would have the stale timer slam the fresh session shut.
    // The session counter increments on every open transition; a timer fires
    // only when its session still owns the dialog.
    const openSessionRef = useRef(0);
    const openRef = useRef(open);
    openRef.current = open;
    const cancelledRef = useRef(false);
    const commitStartedRef = useRef(false);

    // AppShell keeps this dialog mounted and toggles only `open`, so the last
    // export's progress, status and error would otherwise survive a close — a
    // finished bake reopens showing "Baking Complete" with only Close Bakery,
    // and a failure greets the next session with its stale error box.
    useEffect(() => {
        if (!open) {
            return;
        }
        openSessionRef.current += 1;
        setProgress(0);
        setStatusText('');
        setErrorText('');
    }, [open]);

    const loopAvailable = transport.loopEnd > transport.loopStart;
    const marqueeAvailable = clipSelection.marqueeSelection !== null;
    const audioTracks = tracksState.tracks.filter((t) => t.kind === 'audio');
    // Session-only Toaster sequencer patterns (ADR 0045) never reach export by
    // themselves — only a `To timeline` bake does — so an active, un-baked
    // pattern is advisory, non-blocking information the musician needs before
    // assuming this export includes it.
    const unbakedToasterPatterns = listToasterPatternsOutsideArrangement({
        tracks: tracksState.tracks,
        notesByClipId: midi.notesByClipId,
    });

    const resolveRange = (tracks: readonly Track[]): { startBeat: number; durationBeats: number } => {
        const projectMaxBeat = Math.max(16, ...tracks.flatMap((t) => t.clips.map((c) => c.endBeat)));
        if (range === 'loop' && loopAvailable) {
            return {
                startBeat: transport.loopStart,
                durationBeats: Math.max(0.0001, transport.loopEnd - transport.loopStart),
            };
        }
        if (range === 'marquee' && clipSelection.marqueeSelection) {
            const sel = clipSelection.marqueeSelection;
            return {
                startBeat: sel.startBeat,
                durationBeats: Math.max(0.0001, sel.endBeat - sel.startBeat),
            };
        }
        return { startBeat: 0, durationBeats: projectMaxBeat };
    };

    // The descriptor lookup happens here because this view sits
    // downstream of both Arrangement and AudioEngine; wiring it inside
    // AudioEngine instead would make the two modules mutually dependent.
    const deviceTailFor = (deviceType: string) => getPluginById(deviceType)?.tail;

    /**
     * `honorMuted` follows the export mode, matching how the strips are built:
     * a mixdown silences muted tracks, a stem set deliberately does not, so a
     * muted track's chain lengthens a stem render but not a mixdown.
     */
    const detectTail = (honorMuted: boolean, snapshot: TailDetectionSnapshot) =>
        getAutoDetectedTailSeconds({
            tailForDeviceType: deviceTailFor,
            honorMuted,
            tracks: snapshot.tracks,
            soloMode: snapshot.soloMode,
            automationLanes: snapshot.automationLanes,
        });

    const effectiveTailSeconds = (honorMuted: boolean, snapshot: TailDetectionSnapshot): number => {
        if (!autoTail) {
            return Math.max(0, Math.min(MAX_MANUAL_TAIL_SECONDS, tailSeconds));
        }
        // The estimator already caps the detected tail at its own
        // ceiling. Re-clamping here to a second, lower number is what used to
        // truncate long reverbs back to 30 s.
        return Math.max(DEFAULT_EXPORT_TAIL_SECONDS, detectTail(honorMuted, snapshot).seconds);
    };

    const toggleFormat = (freq: ExportFormat) => {
        const next = new Set(formats);
        // Don't allow empty selections
        if (next.has(freq) && next.size > 1) {
            next.delete(freq);
        } else {
            next.add(freq);
        }
        // The stored bit depth is the user's own choice and stays untouched: a
        // format change only constrains which depths are OFFERED and which one
        // the encode resolves to, so unchecking FLAC restores 32-bit.
        setFormats(next);
        saveExportSettings({
            formats: Array.from(next),
            sampleRate,
            bitDepth,
            mp3BitRate,
            dither,
            normalization,
            targetLufs,
        });
    };

    const updateSampleRate = (sr: number) => {
        setSampleRate(sr);
        saveExportSettings({
            formats: Array.from(formats),
            sampleRate: sr,
            bitDepth,
            mp3BitRate,
            dither,
            normalization,
            targetLufs,
        });
    };

    const updateBitDepth = (bd: number) => {
        setBitDepth(bd);
        saveExportSettings({
            formats: Array.from(formats),
            sampleRate,
            bitDepth: bd,
            mp3BitRate,
            dither,
            normalization,
            targetLufs,
        });
    };

    const updateMp3BitRate = (br: Mp3BitRate) => {
        setMp3BitRate(br);
        saveExportSettings({
            formats: Array.from(formats),
            sampleRate,
            bitDepth,
            mp3BitRate: br,
            dither,
            normalization,
            targetLufs,
        });
    };

    const updateDither = (next: ExportDither) => {
        setDither(next);
        saveExportSettings({
            formats: Array.from(formats),
            sampleRate,
            bitDepth,
            mp3BitRate,
            dither: next,
            normalization,
            targetLufs,
        });
    };

    const updateNormalization = (next: ExportNormalization) => {
        setNormalization(next);
        saveExportSettings({
            formats: Array.from(formats),
            sampleRate,
            bitDepth,
            mp3BitRate,
            dither,
            normalization: next,
            targetLufs,
        });
    };

    const updateTargetLufs = (next: number) => {
        if (!Number.isFinite(next) || next < MIN_EXPORT_TARGET_LUFS || next > MAX_EXPORT_TARGET_LUFS) {
            return;
        }
        setTargetLufs(next);
        saveExportSettings({
            formats: Array.from(formats),
            sampleRate,
            bitDepth,
            mp3BitRate,
            dither,
            normalization,
            targetLufs: next,
        });
    };

    const selectDeliveryPreset = (id: string) => {
        setDeliveryPreset(id);
        if (id !== PODCAST_RSS_MP3_PRESET.id) {
            return;
        }
        const settings = PODCAST_RSS_MP3_PRESET.settings;
        setFormats(new Set(settings.formats));
        setSampleRate(settings.sampleRate);
        setBitDepth(settings.bitDepth);
        setMp3BitRate(settings.mp3BitRate);
        setNormalization(settings.normalization);
        setTargetLufs(settings.targetLufs);
        saveExportSettings({ ...settings, formats: [...settings.formats], dither });
    };

    const handleCancel = () => {
        // The Turn off Oven button stays visible through the cancelled window: a repeat click must
        // not replace "Oven turned off." with "Cooling down...".
        if (cancelledRef.current || commitStartedRef.current) {
            return;
        }
        cancelledRef.current = true;
        cancelExport();
        setStatusText('Cooling down...');
    };

    const handleExport = async () => {
        setErrorText('');
        cancelledRef.current = false;
        commitStartedRef.current = false;
        let metadataSnapshot: Parameters<typeof encodeMp3>[4];
        if (mode === 'mixdown' && deliveryPreset === PODCAST_RSS_MP3_PRESET.id && formats.has('mp3')) {
            metadataSnapshot = podcastMetadata;
        }
        const targetLufsSnapshot = targetLufs;
        try {
            if (metadataSnapshot) {
                validatePodcastMetadata(metadataSnapshot);
            }
        } catch (error) {
            setErrorText(error instanceof Error ? error.message : 'Invalid podcast metadata.');
            setProgress(0);
            return;
        }
        const session = openSessionRef.current;
        const ts = Date.now();
        const baseName = `Sourdaw_Bake_${ts}`;

        let nativeDirPath: string | null = null;
        let nativeFilePath: string | null = null;

        let output: Awaited<ReturnType<typeof streamExport>> | undefined;
        const checkCancelled = () => {
            if (cancelledRef.current) {
                throw new Error('Export cancelled');
            }
        };
        // Acquire writable storage before restoring sources or rendering any PCM.
        if (mode !== 'render-to-clip') {
            try {
                const native = isNativeProjectRuntimeAvailable();
                if (native) {
                    if (mode === 'stems') {
                        nativeDirPath = await selectNativeAudioExportDirectory();
                        if (!nativeDirPath) {
                            return;
                        }
                    } else {
                        nativeFilePath = await selectNativeAudioExportFile({
                            formats: Array.from(formats),
                            suggestedName: `${baseName}.${Array.from(formats)[0] ?? 'wav'}`,
                        });
                        if (!nativeFilePath) {
                            return;
                        }
                    }
                }
                const archive = mode === 'stems' || formats.size > 1;
                const primaryExt = Array.from(formats)[0] ?? 'wav';
                const extension = archive ? '.zip' : `.${primaryExt}`;
                setExporting(true);
                setStatusText('Opening export storage...');
                let destination: Parameters<typeof streamExport>[0]['destination'];
                if (native) {
                    destination = {
                        kind: 'native',
                        directoryPath: nativeDirPath ?? undefined,
                        selectedFilePath: nativeFilePath ?? undefined,
                    };
                } else {
                    destination = {
                        kind: 'browser',
                        archive,
                        suggestedName: `${baseName}${extension}`,
                        extension,
                        mime: resolveExportMime(archive, primaryExt),
                    };
                }
                let exportNormalization: Parameters<typeof streamExport>[0]['normalization'];
                if (normalization === 'r128') {
                    exportNormalization = { targetLufs: targetLufsSnapshot, ceilingDbTp: R128_CEILING_DB_TP };
                }
                output = await streamExport({
                    destination,
                    formats: Array.from(formats),
                    bitDepth: resolveExportBitDepths({ formats, selectedBitDepth: bitDepth }).bitDepth,
                    mp3BitRate,
                    dither: resolveExportDither(dither),
                    metadata: metadataSnapshot,
                    normalization: exportNormalization,
                    checkCancelled,
                });
            } catch (error) {
                if (error instanceof Error && error.name === 'AbortError') {
                    setExporting(false);
                    return;
                }
                const message = error instanceof Error ? error.message : 'Export storage is unavailable.';
                setExporting(false);
                setErrorText(message);
                setStatusText('The bread burned...');
                setProgress(0);
                notifyUser(message, 'error');
                return;
            }
        }

        // ── 2. PREPARATIONS COMPLETE. START INTENSIVE BAKING ──
        setExporting(true);
        setProgress(0);
        setStatusText('Heating the offline oven...');

        // Set once the export's last file is being committed: the browser save's close, or the
        // dispatch of the final native write. From then on the export has succeeded and a Cancel no
        // longer decides its outcome, so the export ends in exactly one of the two states.
        let committed = false;
        const endedCancelled = (): boolean => cancelledRef.current && !committed;

        // Every callback a render or encoder calls back into goes through here: work that was past
        // its last checkpoint when Cancel landed still reports, and must not repaint the cancelled state.
        const whileNotCancelled =
            <Args extends unknown[]>(report: (...args: Args) => void) =>
            (...args: Args): void => {
                if (!endedCancelled()) {
                    report(...args);
                }
            };

        try {
            checkCancelled();
            // Restore audio buffers from IndexedDB before rendering.
            // The primary CRDT load path (loadProject → projectCrdtToStores) does not
            // call restoreFromIdb, so on a cold page reload the in-memory cache is empty.
            // This call is idempotent — it skips IDs already in cache — so it is safe
            // to call on every export regardless of how the project was loaded.
            const ctx = getAudioContext();
            if (ctx) {
                // Pass only the buffer IDs referenced by this project's clips so
                // that unrelated takes from other sessions are not mass-loaded.
                const exportTracks = trackStore.value?.tracks ?? [];
                const neededIds = exportTracks
                    .flatMap((time) => time.clips.map((context) => context.audioBufferId))
                    .filter((id): id is string => Boolean(id));
                await restoreCachedAudioBuffersFromIdb({
                    audioContext: ctx,
                    bufferIds: neededIds.length > 0 ? neededIds : undefined,
                });
            } else {
                // Engine not yet initialised (pre-first-gesture) — proceed without
                // restore; buffers may already be warm from a previous operation.
                logger.warn(
                    'AudioContext not available during export — skipping IDB restore. Buffers may be incomplete.'
                );
            }

            // Cancel only raises the render's flag while a render holds the lock, so one pressed
            // during the restore above is seen here or nowhere: no render may start after it.
            if (cancelledRef.current) {
                return;
            }

            const tracks = trackStore.value?.tracks ?? [];
            const tailSnapshot: TailDetectionSnapshot = {
                tracks,
                soloMode: workspaceStore.value?.soloMode ?? defaultWorkspaceState.soloMode,
                automationLanes: automationStore.value?.lanes ?? [],
            };
            const { startBeat, durationBeats } = resolveRange(tracks);
            // Stems keep muted tracks, so they may need a longer tail than the
            // mixdown of the same project.
            const tail = effectiveTailSeconds(mode !== 'stems', tailSnapshot);
            const serializeAudio = async (
                buffer: Parameters<NonNullable<Parameters<typeof renderOffline>[0]['onRendered']>>[0],
                name: string,
                index: number,
                total: number
            ) => {
                if (!output) {
                    throw new Error('Export storage is unavailable.');
                }
                const formatList = Array.from(formats);
                await output.writeAudio({
                    source: buffer,
                    name,
                    onProgress: whileNotCancelled((format, fraction) => {
                        const pass = formatList.indexOf(format);
                        setStatusText(`Kneading ${name} (${format.toUpperCase()})...`);
                        setProgress(((index + (pass + fraction) / formatList.length) / total) * 100);
                    }),
                    onLimited: () =>
                        notifyUser(
                            `${name} needed more gain than the ${R128_CEILING_DB_TP} dBTP ceiling allows, ` +
                                `so it was normalized to the ceiling rather than to ${targetLufsSnapshot} LUFS.`,
                            'warning'
                        ),
                });
            };

            // ── ACTUAL PROCESS ORCHESTRATION ──
            if (mode === 'render-to-clip') {
                setStatusText('Rendering clip (offline)...');
                const rtcWarnings = new Set<string>();
                const buffer = await renderOffline({
                    durationBeats,
                    startBeat,
                    tailSeconds: tail,
                    sampleRate,
                    onProgress: whileNotCancelled((frac: number) => {
                        const barPct = frac * 100;
                        setProgress(barPct);
                        if (Math.round(barPct) % 5 === 0) {
                            setStatusText('Rendering clip...');
                        }
                    }),
                    onWarning: whileNotCancelled((msg: string) => {
                        logger.warn(msg);
                        rtcWarnings.add(msg);
                    }),
                });
                if (rtcWarnings.size > 0) {
                    notifyUser(
                        rtcWarnings.size === 1
                            ? `Render warning: ${[...rtcWarnings][0]}`
                            : `Render completed with ${rtcWarnings.size} warnings — check the console for details.`,
                        'warning'
                    );
                }
                if (cancelledRef.current) {
                    return;
                }
                const endBeat = startBeat + durationBeats;
                const clipName = `Render ${new Date(ts).toLocaleTimeString()}`;
                const result = renderToClip({
                    targetTrackId: renderTargetTrackId,
                    startBeat,
                    endBeat,
                    tailSeconds: tail,
                    buffer,
                    name: clipName,
                });
                if (!result) {
                    throw new Error('Render to Clip: failed to place clip on target track.');
                }
                setProgress(100);
                setStatusText('Clip ready in the timeline.');
                notifyUser('Rendered audio placed as a new clip', 'success');
                setTimeout(() => {
                    if (openSessionRef.current === session && openRef.current) {
                        onClose();
                    }
                }, 1500);
                return;
            }

            if (mode === 'stems') {
                setStatusText('Proofing Slices (rendering stems)...');
                // Accumulate warnings and emit a single summary toast to avoid notification spam
                const stemWarnings = new Set<string>();
                let stemBaseNames = new Map<string, string>();
                await exportStems({
                    durationBeats,
                    startBeat,
                    tailSeconds: tail,
                    sampleRate,
                    onStemPlan: (ids) => {
                        stemBaseNames = deriveStemFileBaseNames({ stemTrackIds: ids, orderedTracks: tracks });
                    },
                    onStem: async (trackId, buffer, index, total) => {
                        await serializeAudio(buffer, stemBaseNames.get(trackId) ?? trackId, index, total);
                    },
                    onProgress: whileNotCancelled((fraction: number) => setProgress(fraction * 100)),
                    onWarning: whileNotCancelled((message: string) => {
                        logger.warn(message);
                        stemWarnings.add(message);
                    }),
                });
                if (stemWarnings.size > 0) {
                    notifyUser(
                        stemWarnings.size === 1
                            ? `Export warning: ${[...stemWarnings][0]}`
                            : `Export completed with ${stemWarnings.size} warnings — check the console for details.`,
                        'warning'
                    );
                }
                if (cancelledRef.current) {
                    return;
                }
            } else {
                setStatusText('Proofing Whole Loaf (offline mixdown)...');
                // Accumulate warnings and emit a single summary toast to avoid notification spam
                const mixWarnings = new Set<string>();
                await renderOffline({
                    onRendered: async (source) => serializeAudio(source, baseName, 0, 1),
                    durationBeats,
                    startBeat,
                    tailSeconds: tail,
                    sampleRate,
                    onProgress: whileNotCancelled((frac: number) => {
                        const barPct = frac * 60;
                        setProgress(barPct);
                        if (Math.round(barPct) % 5 === 0) {
                            setStatusText('Proofing whole loaf...');
                        }
                    }),
                    onWarning: whileNotCancelled((msg: string) => {
                        logger.warn(msg);
                        mixWarnings.add(msg);
                    }),
                });
                if (mixWarnings.size > 0) {
                    notifyUser(
                        mixWarnings.size === 1
                            ? `Export warning: ${[...mixWarnings][0]}`
                            : `Export completed with ${mixWarnings.size} warnings — check the console for details.`,
                        'warning'
                    );
                }
                if (cancelledRef.current) {
                    return;
                }
            }

            if (endedCancelled()) {
                return;
            }

            if (output) {
                await output.commit(() => {
                    committed = true;
                    commitStartedRef.current = true;
                });
            }

            setProgress(100);
            setStatusText('Ding! Baking Complete! 🍞');
            notifyUser('Ding! The audio finished baking', 'success');

            // Auto-close after 2.5s, only if this export's session still owns the dialog
            setTimeout(() => {
                if (openSessionRef.current === session && openRef.current) {
                    onClose();
                }
            }, 2500);
        } catch (error) {
            // A Cancel's own failure is reported by the finally below.
            if (!endedCancelled()) {
                const msg = error instanceof Error ? error.message : 'Unknown oven malfunction';
                logger.error(new Error('Export failed', { cause: error }));
                setErrorText(msg);
                setStatusText('The bread burned...');
                // Reset the bar so a stale half-filled value doesn't render beside the error box
                setProgress(0);
            }
        } finally {
            try {
                await output?.abort();
            } catch (cleanupError) {
                const message = cleanupError instanceof Error ? cleanupError.message : 'Export cleanup failed.';
                logger.error(new Error('Export cleanup failed', { cause: cleanupError }));
                setErrorText(message);
            }
            // Always unlock the UI. On cancel, delay briefly so the status text is readable.
            if (endedCancelled()) {
                // Every Cancel exit before the commit ends here, whether it threw or returned: the
                // export is reported as cancelled, so the bar must not keep the encoder's last
                // figure, and 100 would show the finished state. All uncommitted files were aborted.
                setProgress(0);
                setStatusText('Oven turned off.');
                setTimeout(() => setExporting(false), 1500);
            } else {
                // Success or error — both unblock the button immediately.
                // progress===100 drives the "Close Bakery" button state; exporting===false re-enables export.
                setExporting(false);
            }
        }
    };

    const FORMAT_OPTIONS: { value: ExportFormat; label: string; desc: string }[] = [
        { value: 'wav', label: 'WAV', desc: 'Crisp, lossless' },
        { value: 'mp3', label: 'MP3', desc: 'Lossy crust' },
        { value: 'flac', label: 'FLAC', desc: 'Gluten-free lossless' },
    ];

    const sampleRates = EXPORT_SAMPLE_RATES;
    // Only depths the selected formats can actually deliver are offered (OE-8).
    const { availableBitDepths, bitDepth: effectiveBitDepth } = resolveExportBitDepths({
        formats,
        selectedBitDepth: bitDepth,
    });

    // The status slot is a fixed 40px row for the progress and ready layouts; a
    // failure message wraps to several lines and needs the slot to grow, so the
    // container drops to min-height exactly when this error branch renders.
    const showOvenError = !exporting && progress !== 100 && errorText !== '';

    const renderOvenStatus = (): ReactElement => {
        if (exporting || progress === 100) {
            return (
                <Stack gap={1.5} className="animate-in fade-in duration-300">
                    <Row align="end" justify="between" className="text-xs">
                        <span className={`font-medium ${progress === 100 ? 'text-green-400' : 'text-orange-400'}`}>
                            {statusText}
                        </span>
                        <span className="font-mono text-[10px] text-orange-500/50">{progress.toFixed(0)}%</span>
                    </Row>
                    <div
                        className="h-2 w-full overflow-hidden rounded-full border border-border-hairline bg-surface-well shadow-inner"
                        role="progressbar"
                        aria-valuenow={Math.round(progress)}
                        aria-valuemin={0}
                        aria-valuemax={100}
                    >
                        <div
                            className={`h-full rounded-full transition-all duration-300 ease-out ${
                                progress === 100
                                    ? 'bg-green-500 shadow-[0_0_10px_rgba(34,197,94,0.4)]'
                                    : 'bg-gradient-to-r from-amber-600 to-orange-400 shadow-[0_0_12px_rgba(251,146,60,0.6)]'
                            }`}
                            style={{ width: `${progress}%` }}
                        >
                            {progress < 100 ? (
                                <div className="absolute inset-0 w-[30%] animate-[shimmer_1.5s_infinite] bg-[linear-gradient(90deg,transparent_0%,rgba(255,255,255,0.4)_50%,transparent_100%)]" />
                            ) : null}
                        </div>
                    </div>
                </Stack>
            );
        }
        if (showOvenError) {
            // A failure sets exporting=false and progress=0, so this branch is
            // the only place the failure status is ever visible — keep it beside
            // the error detail.
            return (
                <Stack gap={1} className="animate-in fade-in duration-300">
                    <span className="text-xs font-medium text-red-400">{statusText}</span>
                    <Row className="rounded-lg border border-red-900/30 bg-red-950/20 px-3 text-xs text-red-400">
                        {errorText}
                    </Row>
                </Stack>
            );
        }
        return (
            <Stack
                justify="center"
                className="h-full text-center text-dense uppercase tracking-widest text-muted-foreground"
            >
                {isNativeProjectRuntimeAvailable() ? 'Desktop Oven Ready' : 'Web Oven Ready'}
            </Stack>
        );
    };

    const renderFooter = (): ReactElement => {
        if (exporting) {
            return (
                <Button
                    variant="destructive"
                    size="sm"
                    onClick={handleCancel}
                    className="border border-red-900/50 bg-red-950 text-red-400 hover:bg-red-900 hover:text-red-200"
                >
                    <X className="mr-1 size-3.5" />
                    Turn off Oven
                </Button>
            );
        }
        if (progress === 100) {
            return (
                <Button
                    variant="outline"
                    size="sm"
                    onClick={onClose}
                    className="border-green-900/50 text-green-400 hover:bg-green-950/30 hover:text-green-300"
                >
                    <CheckCircle2 className="mr-1 size-3.5" />
                    Close Bakery
                </Button>
            );
        }
        return (
            <>
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={onClose}
                    data-testid="export-cancel"
                    className="text-muted-foreground hover:text-foreground"
                >
                    Cancel
                </Button>
                <Button
                    size="sm"
                    onClick={handleExport}
                    data-testid="export-start"
                    disabled={(mode !== 'render-to-clip' && formats.size === 0) || isExportActive()}
                    className="border-t border-orange-400/30 bg-orange-600 font-medium text-white shadow-[0_0_15px_rgba(234,88,12,0.3)] transition-all hover:bg-orange-500 hover:shadow-[0_0_20px_rgba(249,115,22,0.5)]"
                >
                    <Flame className="mr-1.5 size-3.5 opacity-80" />
                    {mode === 'render-to-clip' ? 'Render to Clip' : 'Start Baking'}
                </Button>
            </>
        );
    };

    return (
        <Dialog
            open={open}
            onOpenChange={(isOpen) => {
                if (!isOpen && !exporting) {
                    onClose();
                }
            }}
        >
            <DialogContent
                className="max-h-[calc(100vh-2rem)] w-[480px] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden rounded-xl border border-orange-900/40 bg-surface-base p-0 shadow-[0_0_40px_rgba(234,88,12,0.1)]"
                showCloseButton={!exporting}
            >
                <DialogHeader
                    className="relative overflow-hidden px-6 pb-4 pt-6 rounded-t-xl"
                    style={{
                        background: 'linear-gradient(180deg, rgba(120,53,15,0.4) 0%, rgba(10,10,10,1) 100%)',
                        boxShadow: 'inset 0 1px 0 rgba(251,146,60,0.1), inset 0 -1px rgba(251,146,60,0.05)',
                        margin: '-1.5rem -1.5rem 0 -1.5rem',
                    }}
                >
                    <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_var(--tw-gradient-stops))] from-amber-500/10 via-transparent to-transparent" />
                    <DialogTitle className="relative flex items-center gap-2 text-base font-semibold text-orange-50/90">
                        <Flame className="size-4 text-orange-500" />
                        The Bakery
                    </DialogTitle>
                    <p className="mt-0.5 text-xs tracking-wide text-orange-500/60">
                        Export your masterpiece straight from the Sourdaw oven.
                    </p>
                </DialogHeader>

                <DawDialogBody scrollable className="gap-4 bg-transparent px-6 py-5">
                    <DawDialogSection tone="warm" title="Render Order">
                        <Grid cols={3} gap={2}>
                            <Button
                                variant={mode === 'mixdown' ? 'default' : 'outline'}
                                size="sm"
                                onClick={() => setMode('mixdown')}
                                data-testid="export-mode-mixdown"
                                className={
                                    mode === 'mixdown'
                                        ? 'w-full border-orange-500/30 bg-orange-700/20 text-orange-300 hover:bg-orange-700/30'
                                        : 'w-full border-orange-900/40 text-muted-foreground hover:border-orange-500/20 hover:bg-orange-950/20 hover:text-orange-200'
                                }
                                disabled={exporting}
                                style={mode === 'mixdown' ? { boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.05)' } : {}}
                            >
                                Whole Loaf <span className="ml-1 text-[10px] opacity-60">(Mixdown)</span>
                            </Button>
                            <Button
                                variant={mode === 'stems' ? 'default' : 'outline'}
                                size="sm"
                                onClick={() => setMode('stems')}
                                data-testid="export-mode-stems"
                                className={
                                    mode === 'stems'
                                        ? 'w-full border-amber-500/30 bg-amber-700/20 text-amber-300 hover:bg-amber-700/30'
                                        : 'w-full border-orange-900/40 text-muted-foreground hover:border-amber-500/20 hover:bg-amber-950/20 hover:text-amber-200'
                                }
                                disabled={exporting}
                                style={mode === 'stems' ? { boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.05)' } : {}}
                            >
                                Slices <span className="ml-1 text-[10px] opacity-60">(Stems)</span>
                            </Button>
                            <Button
                                variant={mode === 'render-to-clip' ? 'default' : 'outline'}
                                size="sm"
                                onClick={() => setMode('render-to-clip')}
                                className={
                                    mode === 'render-to-clip'
                                        ? 'w-full border-amber-500/30 bg-amber-700/20 text-amber-300 hover:bg-amber-700/30'
                                        : 'w-full border-orange-900/40 text-muted-foreground hover:border-amber-500/20 hover:bg-amber-950/20 hover:text-amber-200'
                                }
                                disabled={exporting}
                                style={
                                    mode === 'render-to-clip'
                                        ? { boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.05)' }
                                        : {}
                                }
                            >
                                To Clip <span className="ml-1 text-[10px] opacity-60">(Inline)</span>
                            </Button>
                        </Grid>
                    </DawDialogSection>

                    <DawDialogSection tone="warm" title="Render Range">
                        <Stack gap={1.5} role="radiogroup" aria-label="Render range">
                            <RangeRadio
                                label="Whole project"
                                value="project"
                                activeValue={range}
                                onChange={setRange}
                                disabled={exporting}
                            />
                            <RangeRadio
                                label={
                                    loopAvailable
                                        ? `Loop region (beat ${transport.loopStart.toFixed(2)} → ${transport.loopEnd.toFixed(2)})`
                                        : 'Loop region (set a loop first)'
                                }
                                value="loop"
                                activeValue={range}
                                onChange={setRange}
                                disabled={exporting || !loopAvailable}
                            />
                            <RangeRadio
                                label={
                                    marqueeAvailable
                                        ? `Marquee selection (${(clipSelection.marqueeSelection?.endBeat ?? 0) - (clipSelection.marqueeSelection?.startBeat ?? 0)} beats)`
                                        : 'Marquee selection (none)'
                                }
                                value="marquee"
                                activeValue={range}
                                onChange={setRange}
                                disabled={exporting || !marqueeAvailable}
                            />
                        </Stack>
                    </DawDialogSection>

                    <DawDialogSection tone="warm" title="Tail" detail="Extra seconds so reverb/delay can ring out.">
                        <Row gap={3}>
                            <Row gap={2}>
                                <Input
                                    type="number"
                                    min={0}
                                    max={MAX_MANUAL_TAIL_SECONDS}
                                    step={0.1}
                                    value={autoTail ? '' : tailSeconds}
                                    disabled={exporting || autoTail}
                                    onChange={(e) => {
                                        const next = Number(e.target.value);
                                        if (Number.isFinite(next)) {
                                            setTailSeconds(Math.max(0, Math.min(MAX_MANUAL_TAIL_SECONDS, next)));
                                        }
                                    }}
                                    aria-label="Tail seconds"
                                    className="h-auto w-20 rounded-md border border-border-hairline bg-surface-well px-2 py-1 text-xs text-foreground disabled:opacity-40"
                                />
                                <span className="text-dense text-muted-foreground">seconds</span>
                            </Row>
                            <Row as="label" gap={1.5} className="text-compact text-muted-foreground">
                                <DawCompactCheckbox
                                    type="checkbox"
                                    checked={autoTail}
                                    onChange={(e) => setAutoTail(e.target.checked)}
                                    disabled={exporting}
                                    className="accent-orange-500"
                                />
                                Auto-detect
                            </Row>
                            {autoTail ? (
                                <AutoDetectedTailLabel
                                    honorMuted={mode !== 'stems'}
                                    tracks={tracksState.tracks}
                                    soloMode={workspace.soloMode}
                                    automationLanes={automation.lanes}
                                />
                            ) : null}
                        </Row>
                    </DawDialogSection>

                    {mode === 'render-to-clip' ? (
                        <DawDialogSection
                            tone="warm"
                            title="Target Track"
                            detail="Where to place the rendered audio clip."
                        >
                            <DawCompactSelect
                                value={renderTargetTrackId}
                                onChange={(e) => setRenderTargetTrackId(e.target.value)}
                                disabled={exporting}
                                aria-label="Target track"
                                className="w-full rounded-md border border-border-hairline bg-surface-well px-2 py-1.5 text-xs text-foreground"
                            >
                                <option value="new">New audio track</option>
                                {audioTracks.map((t) => (
                                    <option key={t.id} value={t.id}>
                                        {t.name || t.id}
                                    </option>
                                ))}
                            </DawCompactSelect>
                        </DawDialogSection>
                    ) : null}

                    {mode === 'mixdown' ? (
                        <DawDialogSection tone="warm" title="Delivery preset">
                            <DawCompactSelect
                                aria-label="Delivery preset"
                                value={deliveryPreset}
                                disabled={exporting}
                                onChange={(event) => selectDeliveryPreset(event.target.value)}
                            >
                                <option value="custom">Custom</option>
                                <option value={PODCAST_RSS_MP3_PRESET.id}>{PODCAST_RSS_MP3_PRESET.name}</option>
                            </DawCompactSelect>
                            <p className="mt-2 text-dense text-muted-foreground">Stereo (2 channels)</p>
                            {deliveryPreset === PODCAST_RSS_MP3_PRESET.id ? (
                                <Stack gap={2}>
                                    <p className="text-dense text-muted-foreground">
                                        Loudness and peak targets apply before encoding. MP3 encoding can alter peaks.
                                    </p>
                                    <Input
                                        aria-label="Episode title"
                                        placeholder="Episode title"
                                        disabled={exporting}
                                        value={podcastMetadata.title}
                                        onChange={(event) =>
                                            setPodcastMetadata({ ...podcastMetadata, title: event.target.value })
                                        }
                                    />
                                    <Input
                                        aria-label="Artist"
                                        placeholder="Artist"
                                        disabled={exporting}
                                        value={podcastMetadata.artist}
                                        onChange={(event) =>
                                            setPodcastMetadata({ ...podcastMetadata, artist: event.target.value })
                                        }
                                    />
                                    <Input
                                        aria-label="Description"
                                        placeholder="Description"
                                        disabled={exporting}
                                        value={podcastMetadata.description}
                                        onChange={(event) =>
                                            setPodcastMetadata({ ...podcastMetadata, description: event.target.value })
                                        }
                                    />
                                </Stack>
                            ) : null}
                        </DawDialogSection>
                    ) : null}

                    {mode !== 'render-to-clip' ? (
                        <>
                            <DawDialogSection tone="warm" title="Ingredients">
                                <Grid cols={3} gap={2}>
                                    {FORMAT_OPTIONS.map((freq) => {
                                        const active = formats.has(freq.value);
                                        return (
                                            <Button
                                                variant="bare"
                                                size="bare"
                                                type="button"
                                                key={freq.value}
                                                data-testid={`export-format-${freq.value}`}
                                                className={`rounded-lg border px-3 py-2.5 text-left transition-all ${
                                                    active
                                                        ? 'border-orange-500/40 bg-orange-950/40 shadow-[inset_0_1px_0_rgba(251,146,60,0.1)]'
                                                        : 'border-border-hairline bg-surface-panel hover:border-border hover:bg-surface-raised'
                                                }`}
                                                onClick={() => toggleFormat(freq.value)}
                                                aria-pressed={active}
                                                role="checkbox"
                                                aria-checked={active}
                                                disabled={exporting}
                                            >
                                                <div
                                                    className={`text-sm font-semibold ${active ? 'text-orange-200' : 'text-muted-foreground'}`}
                                                >
                                                    {freq.label}
                                                </div>
                                                <div
                                                    className={`mt-0.5 text-[10px] ${active ? 'text-orange-400/80' : 'text-muted-foreground/60'}`}
                                                >
                                                    {freq.desc}
                                                </div>
                                            </Button>
                                        );
                                    })}
                                </Grid>
                            </DawDialogSection>

                            <DawDialogSection
                                tone="warm"
                                title="Fidelity"
                                detail="Choose sample rate, bit depth, and compression quality."
                                bodyClassName={`grid gap-4 ${formats.has('mp3') ? 'grid-cols-3' : 'grid-cols-2'}`}
                            >
                                <div className="rounded-lg border border-border-hairline bg-surface-well/50 p-3">
                                    <DawEyebrowLabel
                                        size="sm"
                                        className="mb-2 block font-bold tracking-widest text-muted-foreground/70"
                                    >
                                        Sample Rate
                                    </DawEyebrowLabel>
                                    <Row align="stretch" wrap gap={1}>
                                        {sampleRates.map((sr) => (
                                            <Button
                                                key={sr}
                                                variant="ghost"
                                                size="sm"
                                                className={`h-6 rounded-md px-2 text-[10px] ${
                                                    sampleRate === sr
                                                        ? 'bg-surface-raised text-foreground font-medium shadow-sm'
                                                        : 'text-muted-foreground hover:bg-surface-panel hover:text-foreground'
                                                }`}
                                                onClick={() => updateSampleRate(sr)}
                                                disabled={exporting}
                                            >
                                                {(sr / 1000).toFixed(1)}k
                                            </Button>
                                        ))}
                                    </Row>
                                </div>

                                <div className="rounded-lg border border-border-hairline bg-surface-well/50 p-3">
                                    <DawEyebrowLabel
                                        size="sm"
                                        className="mb-2 block font-bold tracking-widest text-muted-foreground/70"
                                    >
                                        Bit Depth
                                    </DawEyebrowLabel>
                                    <Row align="stretch" wrap gap={1}>
                                        {availableBitDepths.map((bd) => (
                                            <Button
                                                key={bd}
                                                variant="ghost"
                                                size="sm"
                                                className={`h-6 rounded-md px-2 text-[10px] ${
                                                    effectiveBitDepth === bd
                                                        ? 'bg-surface-raised text-foreground font-medium shadow-sm'
                                                        : 'text-muted-foreground hover:bg-surface-panel hover:text-foreground'
                                                }`}
                                                onClick={() => updateBitDepth(bd)}
                                                disabled={exporting}
                                            >
                                                {bd}-bit
                                            </Button>
                                        ))}
                                    </Row>
                                </div>

                                <div className="rounded-lg border border-border-hairline bg-surface-well/50 p-3">
                                    <DawEyebrowLabel
                                        size="sm"
                                        className="mb-2 block font-bold tracking-widest text-muted-foreground/70"
                                    >
                                        Loudness
                                    </DawEyebrowLabel>
                                    <Row align="stretch" wrap gap={1}>
                                        {(
                                            [
                                                { value: 'off', label: 'As mixed' },
                                                { value: 'r128', label: `${targetLufs} LUFS` },
                                            ] as const
                                        ).map((option) => (
                                            <Button
                                                key={option.value}
                                                variant="ghost"
                                                size="sm"
                                                className={`h-6 rounded-md px-2 text-[10px] ${
                                                    normalization === option.value
                                                        ? 'bg-surface-raised text-foreground font-medium shadow-sm'
                                                        : 'text-muted-foreground hover:bg-surface-panel hover:text-foreground'
                                                }`}
                                                onClick={() => updateNormalization(option.value)}
                                                disabled={exporting}
                                            >
                                                {option.label}
                                            </Button>
                                        ))}
                                    </Row>
                                    {normalization === 'r128' ? (
                                        <Input
                                            aria-label="Target loudness"
                                            type="number"
                                            min={MIN_EXPORT_TARGET_LUFS}
                                            max={MAX_EXPORT_TARGET_LUFS}
                                            step={0.1}
                                            value={targetLufs}
                                            disabled={exporting}
                                            onChange={(event) => updateTargetLufs(Number(event.target.value))}
                                        />
                                    ) : null}
                                    <p className="mt-1.5 text-dense text-muted-foreground/70">
                                        Measures programme loudness and inter-sample peaks, then applies one gain to
                                        reach the target without exceeding {R128_CEILING_DB_TP} dBTP.
                                    </p>
                                </div>

                                <div className="rounded-lg border border-border-hairline bg-surface-well/50 p-3">
                                    <DawEyebrowLabel
                                        size="sm"
                                        className="mb-2 block font-bold tracking-widest text-muted-foreground/70"
                                    >
                                        Dither
                                    </DawEyebrowLabel>
                                    <Row align="stretch" wrap gap={1}>
                                        {(
                                            [
                                                { value: 'random', label: 'Random' },
                                                { value: 'seeded', label: 'Repeatable' },
                                                { value: 'none', label: 'Off' },
                                            ] as const
                                        ).map((option) => (
                                            <Button
                                                key={option.value}
                                                variant="ghost"
                                                size="sm"
                                                className={`h-6 rounded-md px-2 text-[10px] ${
                                                    dither === option.value
                                                        ? 'bg-surface-raised text-foreground font-medium shadow-sm'
                                                        : 'text-muted-foreground hover:bg-surface-panel hover:text-foreground'
                                                }`}
                                                onClick={() => updateDither(option.value)}
                                                disabled={exporting}
                                            >
                                                {option.label}
                                            </Button>
                                        ))}
                                    </Row>
                                    <p className="mt-1.5 text-dense text-muted-foreground/70">
                                        Repeatable re-exports the same project to identical bytes. Off skips dither
                                        entirely for a bit-exact bounce.
                                    </p>
                                </div>

                                {formats.has('mp3') ? (
                                    <div className="rounded-lg border border-border-hairline bg-surface-well/50 p-3">
                                        <DawEyebrowLabel
                                            size="sm"
                                            className="mb-2 block font-bold tracking-widest text-muted-foreground/70"
                                        >
                                            MP3 Quality
                                        </DawEyebrowLabel>
                                        <Row align="stretch" wrap gap={1}>
                                            {([96, 128, 192, 320] as Mp3BitRate[]).map((br) => (
                                                <Button
                                                    key={br}
                                                    variant="ghost"
                                                    size="sm"
                                                    className={`h-6 rounded-md px-2 text-[10px] ${
                                                        mp3BitRate === br
                                                            ? 'bg-surface-raised text-foreground font-medium shadow-sm'
                                                            : 'text-muted-foreground hover:bg-surface-panel hover:text-foreground'
                                                    }`}
                                                    onClick={() => updateMp3BitRate(br)}
                                                    disabled={exporting}
                                                >
                                                    {br}k
                                                </Button>
                                            ))}
                                        </Row>
                                    </div>
                                ) : null}
                            </DawDialogSection>
                        </>
                    ) : null}

                    <DawDialogSection
                        tone="warm"
                        title="Oven Status"
                        detail={isNativeProjectRuntimeAvailable() ? 'Desktop oven ready' : 'Web oven ready'}
                    >
                        <div className={showOvenError ? 'min-h-10' : 'h-10'}>{renderOvenStatus()}</div>
                    </DawDialogSection>

                    {unbakedToasterPatterns.length > 0 ? (
                        <Stack gap={1.5}>
                            {unbakedToasterPatterns.map((entry) => (
                                <Row
                                    key={`${entry.trackId}-${entry.deviceName}`}
                                    role="status"
                                    className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300"
                                >
                                    Toaster &quot;{entry.deviceName}&quot; on &quot;{entry.trackName}&quot; has a
                                    sequencer pattern that is not in the arrangement. Use To timeline on the device to
                                    include it in the export.
                                </Row>
                            ))}
                        </Stack>
                    ) : null}
                </DawDialogBody>

                <DawDialogFooter tone="warm" align="end" className="px-6">
                    {renderFooter()}
                </DawDialogFooter>
            </DialogContent>
        </Dialog>
    );
};

type RangeRadioProps = {
    label: string;
    value: ExportRange;
    activeValue: ExportRange;
    disabled: boolean;
    onChange: (value: ExportRange) => void;
};

const RangeRadio = ({ label, value, activeValue, disabled, onChange }: RangeRadioProps): ReactElement => {
    const active = activeValue === value;
    return (
        <label
            className={`flex cursor-pointer items-center gap-2 rounded-md border px-2 py-1.5 text-compact transition-all ${
                active
                    ? 'border-orange-500/30 bg-orange-950/40 text-orange-200'
                    : 'border-border-hairline bg-surface-raised text-muted-foreground hover:border-border hover:text-foreground'
            } ${disabled ? 'cursor-not-allowed opacity-40' : ''}`}
        >
            <input
                type="radio"
                name="export-range"
                value={value}
                checked={active}
                disabled={disabled}
                onChange={() => onChange(value)}
                className="accent-orange-500"
            />
            {label}
        </label>
    );
};
