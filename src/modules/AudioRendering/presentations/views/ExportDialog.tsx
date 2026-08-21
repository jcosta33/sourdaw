import { type ReactElement, useState, useRef } from 'react';

import { zipSync } from 'fflate';
import { Flame, X, CheckCircle2 } from 'lucide-react';

import { DawDialogBody } from '#/components/daw/DawDialogBody';
import { DawDialogFooter } from '#/components/daw/DawDialogFooter';
import { DawDialogSection } from '#/components/daw/DawDialogSection';
import { DawEyebrowLabel } from '#/components/daw/DawEyebrowLabel';
import { Row, Stack } from '#/components/layout';
import { Button } from '#/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '#/components/ui/dialog';
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
import { isNativeProjectRuntimeAvailable } from '#/modules/Project/useCases';
import { transportStore, defaultTransportState } from '#/modules/Transport/stores';
import { defaultWorkspaceState, workspaceStore, type WorkspaceState } from '#/modules/WorkspaceShell/stores';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { audioBufferToFlac as encodeFlac } from '../../useCases/audioBufferToFlac';
import { audioBufferToMp3 as encodeMp3 } from '../../useCases/audioBufferToMp3';
import { audioBufferToWav as encodeWav } from '../../useCases/audioBufferToWav';
import { selectNativeAudioExportDirectory } from '../../useCases/audioExport/selectNativeAudioExportDirectory';
import { selectNativeAudioExportFile } from '../../useCases/audioExport/selectNativeAudioExportFile';
import { writeNativeAudioMixdownFile } from '../../useCases/audioExport/writeNativeAudioMixdownFile';
import { writeNativeAudioStemFile } from '../../useCases/audioExport/writeNativeAudioStemFile';
import { normalizeExportBuffer } from '../../useCases/normalizeExportBuffer';
import { renderToClip } from '../../useCases/renderToClip';

import { deriveStemFileBaseNames } from './deriveStemFileBaseNames';
import {
    loadExportSettings,
    MAX_MANUAL_TAIL_SECONDS,
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

type WebFileHandle = {
    createWritable: () => Promise<{
        write: (data: Uint8Array) => Promise<void>;
        close: () => Promise<void>;
    }>;
};

type ShowSaveFilePicker = (opts: {
    suggestedName?: string;
    types?: { accept: Record<string, string[]> }[];
}) => Promise<WebFileHandle>;

/**
 * The File System Access API (`window.showSaveFilePicker`) is not in the
 * standard `Window` lib types. Narrow the value at the call boundary instead
 * of asserting through `unknown`.
 */
const getShowSaveFilePicker = (): ShowSaveFilePicker | null => {
    const candidate = (window as Window & { showSaveFilePicker?: unknown }).showSaveFilePicker;
    return typeof candidate === 'function' ? (candidate as ShowSaveFilePicker) : null;
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
    const [exporting, setExporting] = useState(false);
    const [progress, setProgress] = useState(0);
    const [statusText, setStatusText] = useState('');
    const [errorText, setErrorText] = useState('');
    const cancelledRef = useRef(false);

    const loopAvailable = transport.loopEnd > transport.loopStart;
    const marqueeAvailable = clipSelection.marqueeSelection !== null;
    const audioTracks = tracksState.tracks.filter((t) => t.kind === 'audio');

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
        saveExportSettings({ formats: Array.from(next), sampleRate, bitDepth, mp3BitRate, dither, normalization });
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
        });
    };

    const handleCancel = () => {
        cancelledRef.current = true;
        cancelExport();
        setStatusText('Cooling down...');
    };

    // Helper: Trigger browser fallback download if Native API fails or is missing
    const triggerFallbackBlobDownload = (data: Uint8Array | ArrayBuffer, ext: string, blobName: string) => {
        const mimeMap: Record<string, string> = {
            '.wav': 'audio/wav',
            '.mp3': 'audio/mpeg',
            '.flac': 'audio/flac',
            '.zip': 'application/zip',
        };
        // eslint-disable-next-line sourdaw/no-type-assertion-escape -- Uint8Array<ArrayBufferLike> requires cast to BlobPart; structurally safe at runtime
        const blob = new Blob([data as unknown as BlobPart], { type: mimeMap[ext] || 'application/octet-stream' });
        const url = URL.createObjectURL(blob);
        const alpha = document.createElement('a');
        alpha.href = url;
        alpha.download = `${blobName}${ext}`;
        alpha.style.display = 'none';
        document.body.appendChild(alpha);
        alpha.click();
        setTimeout(() => {
            document.body.removeChild(alpha);
            URL.revokeObjectURL(url);
        }, 1500); // 1.5s to ensure click dispatches
    };

    const handleExport = async () => {
        setErrorText('');
        cancelledRef.current = false;
        const ts = Date.now();
        const baseName = `Sourdaw_Bake_${ts}`;

        let nativeDirPath: string | null = null;
        let nativeFilePath: string | null = null;

        // This Handle uses the new FileSystem Access API
        let webFileHandle: WebFileHandle | null = null;

        // ── 1. SECURE THE DESTINATION EARLY ──
        if (mode !== 'render-to-clip') {
            try {
                if (isNativeProjectRuntimeAvailable()) {
                    if (mode === 'stems') {
                        nativeDirPath = await selectNativeAudioExportDirectory();
                        if (!nativeDirPath) {
                            return;
                        } // User cancelled
                    } else {
                        const primaryExt = Array.from(formats)[0] || 'wav';
                        nativeFilePath = await selectNativeAudioExportFile({
                            formats: Array.from(formats),
                            suggestedName: `${baseName}.${primaryExt}`,
                        });
                        if (!nativeFilePath) {
                            return;
                        } // User cancelled
                    }
                } else {
                    // Web Environment
                    const showSaveFilePicker = getShowSaveFilePicker();
                    if (showSaveFilePicker) {
                        const isZip = mode === 'stems' || formats.size > 1; // Zipping required for >1 file
                        const primaryExt = Array.from(formats)[0] || 'wav';
                        const fileExt = isZip ? '.zip' : `.${primaryExt}`;
                        const mime = resolveExportMime(isZip, primaryExt);

                        webFileHandle = await showSaveFilePicker({
                            suggestedName: `${baseName}${fileExt}`,
                            types: [{ accept: { [mime]: [fileExt] } }],
                        });
                    }
                }
            } catch (error) {
                // If user clicked cancel, abort quietly
                if (error instanceof Error && error.name === 'AbortError') {
                    return;
                }
                // Otherwise, allow it to drop to fallback `<a download>` memory mode
            }
        }

        // ── 2. PREPARATIONS COMPLETE. START INTENSIVE BAKING ──
        setExporting(true);
        setProgress(0);
        setStatusText('Heating the offline oven...');

        try {
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
            const bd = resolveExportBitDepths({ formats, selectedBitDepth: bitDepth }).bitDepth;
            // Every encoder gets the same dither decision, so a seeded
            // or undithered export is reproducible in all selected formats.
            const ditherOptions = resolveExportDither(dither);
            const formatList = Array.from(formats);

            // We use fflate purely to zip multiple web stems / formats
            const zipDirectory: Record<string, Uint8Array> = {};

            const serializeAudio = async (
                buffer: AudioBuffer,
                name: string,
                fractionOffset: number,
                fractionRange: number
            ) => {
                // Normalize once, before the format loop, so every
                // requested format is encoded from identical audio.
                if (normalization === 'r128') {
                    setStatusText(`Measuring ${name}...`);
                    const result = normalizeExportBuffer({
                        buffer,
                        targetLufs: R128_TARGET_LUFS,
                        ceilingDbTp: R128_CEILING_DB_TP,
                    });
                    if (result.limitedByCeiling) {
                        notifyUser(
                            `${name} needed more gain than the ${R128_CEILING_DB_TP} dBTP ceiling allows, ` +
                                `so it was normalized to the ceiling rather than to ${R128_TARGET_LUFS} LUFS.`,
                            'warning'
                        );
                    }
                }

                let currentPass = 0;
                for (const freq of formatList) {
                    if (cancelledRef.current) {
                        return;
                    }

                    const passProgress = (frac: number) => {
                        const subFraction = (currentPass + frac) / formatList.length;
                        setProgress(fractionOffset + subFraction * fractionRange);
                    };

                    setStatusText(`Kneading ${name} (${freq.toUpperCase()})...`);
                    let fileData: Uint8Array | ArrayBuffer;

                    if (freq === 'mp3') {
                        fileData = await encodeMp3(buffer, mp3BitRate, passProgress, ditherOptions);
                    } else if (freq === 'flac') {
                        if (bd === 32) {
                            throw new Error('FLAC export supports 16-bit or 24-bit only.');
                        }
                        fileData = await encodeFlac(buffer, bd, passProgress, ditherOptions);
                    } else {
                        fileData = await encodeWav(buffer, bd, passProgress, ditherOptions);
                    }

                    const uint8Data = fileData instanceof ArrayBuffer ? new Uint8Array(fileData) : fileData;
                    const finalFileName = `${name}.${freq}`;

                    if (isNativeProjectRuntimeAvailable()) {
                        if (mode === 'stems' && nativeDirPath) {
                            await writeNativeAudioStemFile({
                                bytes: uint8Data,
                                directoryPath: nativeDirPath,
                                fileName: finalFileName,
                            });
                        } else if (nativeFilePath) {
                            await writeNativeAudioMixdownFile({
                                bytes: uint8Data,
                                format: freq,
                                selectedFilePath: nativeFilePath,
                            });
                        }
                    } else {
                        // Web: Pack into the zip directory for later synchronous fflate compression
                        zipDirectory[finalFileName] = uint8Data;
                    }

                    currentPass++;
                }
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
                    onProgress: (frac) => {
                        const barPct = frac * 100;
                        setProgress(barPct);
                        if (Math.round(barPct) % 5 === 0) {
                            setStatusText('Rendering clip...');
                        }
                    },
                    onWarning: (msg) => {
                        logger.warn(msg);
                        rtcWarnings.add(msg);
                    },
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
                    if (open) {
                        onClose();
                    }
                }, 1500);
                return;
            }

            if (mode === 'stems') {
                setStatusText('Proofing Slices (rendering stems)...');
                // Accumulate warnings and emit a single summary toast to avoid notification spam
                const stemWarnings = new Set<string>();
                const stems = await exportStems({
                    durationBeats,
                    startBeat,
                    tailSeconds: tail,
                    sampleRate,
                    onProgress: (frac) => {
                        const barPct = frac * 50;
                        setProgress(barPct);
                        if (Math.round(barPct) % 5 === 0) {
                            setStatusText('Proofing slices...');
                        }
                    },
                    onWarning: (msg) => {
                        logger.warn(msg);
                        stemWarnings.add(msg);
                    },
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

                let doneStems = 0;
                const totalStems = stems.size;

                // Collision-free per-stem filenames (OE-2): key disambiguation off the
                // already-unique track id so a second track sharing a name cannot overwrite
                // the first stem on disk (native dir) or in the web zip map. Derive from the
                // stable store track order — not the pool's render-completion order — so the
                // track→filename mapping is reproducible across identical exports.
                const stemBaseNames = deriveStemFileBaseNames({
                    stemTrackIds: stems.keys(),
                    orderedTracks: tracks,
                });

                for (const [trackId, buffer] of stems) {
                    if (cancelledRef.current) {
                        return;
                    }
                    const safeTName = stemBaseNames.get(trackId) ?? trackId;

                    // We map the remaining 50% of the progress bar to encoding the slices
                    const stemOffset = 50 + (doneStems / totalStems) * 50;
                    const stemRange = 50 / totalStems;

                    await serializeAudio(buffer, safeTName, stemOffset, stemRange);
                    doneStems++;
                }
            } else {
                setStatusText('Proofing Whole Loaf (offline mixdown)...');
                // Accumulate warnings and emit a single summary toast to avoid notification spam
                const mixWarnings = new Set<string>();
                const buffer = await renderOffline({
                    durationBeats,
                    startBeat,
                    tailSeconds: tail,
                    sampleRate,
                    onProgress: (frac) => {
                        const barPct = frac * 60;
                        setProgress(barPct);
                        if (Math.round(barPct) % 5 === 0) {
                            setStatusText('Proofing whole loaf...');
                        }
                    },
                    onWarning: (msg) => {
                        logger.warn(msg);
                        mixWarnings.add(msg);
                    },
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

                // We map the remaining 40% of the progress bar to encoding the mixdown
                await serializeAudio(buffer, baseName, 60, 40);
            }

            if (cancelledRef.current) {
                return;
            }

            // ── 3. FINALIZE WEB SAVES ──
            if (!isNativeProjectRuntimeAvailable() && Object.keys(zipDirectory).length > 0) {
                setStatusText('Serving hot audio...');
                const isSingleFile = Object.keys(zipDirectory).length === 1 && mode !== 'stems';

                let finalBytes: Uint8Array;
                let finalExt: string;
                let finalName: string;

                if (isSingleFile) {
                    const singleKey = Object.keys(zipDirectory)[0]!;
                    finalBytes = zipDirectory[singleKey]!;
                    finalExt = `.${singleKey.split('.').pop()!}`;
                    finalName = baseName;
                } else {
                    // Zip the results synchronously
                    finalBytes = zipSync(zipDirectory, { level: 0 }); // level 0 for speed, audio doesn't compress well anyway
                    finalExt = '.zip';
                    finalName = mode === 'stems' ? `Sourdaw_Slices_${ts}` : `Sourdaw_Bakery_${ts}`;
                }

                if (webFileHandle) {
                    // File System Access Method
                    const writable = await webFileHandle.createWritable();
                    await writable.write(finalBytes);
                    await writable.close();
                } else {
                    // Fallback
                    triggerFallbackBlobDownload(finalBytes, finalExt, finalName);
                }
            }

            setProgress(100);
            setStatusText('Ding! Baking Complete! 🍞');
            notifyUser('Ding! The audio finished baking', 'success');

            // Auto-close after 2.5s
            setTimeout(() => {
                if (open) {
                    onClose();
                }
            }, 2500);
        } catch (error) {
            if (cancelledRef.current) {
                setStatusText('Oven turned off.');
            } else {
                const msg = error instanceof Error ? error.message : 'Unknown oven malfunction';
                logger.error(new Error('Export failed', { cause: error }));
                setErrorText(msg);
                setStatusText('The bread burned...');
                // Reset the bar so a stale half-filled value doesn't render beside the error box
                setProgress(0);
            }
        } finally {
            // Always unlock the UI. On cancel, delay briefly so the status text is readable.
            if (cancelledRef.current) {
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

    const sampleRates = [44100, 48000, 88200, 96000];
    // Only depths the selected formats can actually deliver are offered (OE-8).
    const { availableBitDepths, bitDepth: effectiveBitDepth } = resolveExportBitDepths({
        formats,
        selectedBitDepth: bitDepth,
    });

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
                        className="h-2 w-full overflow-hidden rounded-full border border-stone-800 bg-stone-900 shadow-inner"
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
        if (errorText) {
            return (
                <Row className="h-full rounded-lg border border-red-900/30 bg-red-950/20 px-3 text-xs text-red-400 animate-in fade-in">
                    {errorText}
                </Row>
            );
        }
        return (
            <Stack justify="center" className="h-full text-center text-[10px] uppercase tracking-widest text-stone-500">
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
                    className="text-stone-400 hover:text-stone-200"
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
                className="max-h-[calc(100vh-2rem)] w-[480px] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden rounded-xl border border-orange-900/40 bg-stone-950 p-0 shadow-[0_0_40px_rgba(234,88,12,0.1)]"
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
                        <div className="grid grid-cols-3 gap-2">
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
                        </div>
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
                                <input
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
                                    className="w-20 rounded-md border border-stone-800 bg-stone-900/70 px-2 py-1 text-xs text-stone-200 disabled:opacity-40"
                                />
                                <span className="text-[10px] text-stone-500">seconds</span>
                            </Row>
                            <Row as="label" gap={1.5} className="text-[11px] text-stone-400">
                                <input
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
                            <select
                                value={renderTargetTrackId}
                                onChange={(e) => setRenderTargetTrackId(e.target.value)}
                                disabled={exporting}
                                aria-label="Target track"
                                className="w-full rounded-md border border-stone-800 bg-stone-900/70 px-2 py-1.5 text-xs text-stone-200"
                            >
                                <option value="new">New audio track</option>
                                {audioTracks.map((t) => (
                                    <option key={t.id} value={t.id}>
                                        {t.name || t.id}
                                    </option>
                                ))}
                            </select>
                        </DawDialogSection>
                    ) : null}

                    {mode !== 'render-to-clip' ? (
                        <>
                            <DawDialogSection tone="warm" title="Ingredients">
                                <div className="grid grid-cols-3 gap-2">
                                    {FORMAT_OPTIONS.map((freq) => {
                                        const active = formats.has(freq.value);
                                        return (
                                            <button
                                                type="button"
                                                key={freq.value}
                                                data-testid={`export-format-${freq.value}`}
                                                className={`rounded-lg border px-3 py-2.5 text-left transition-all ${
                                                    active
                                                        ? 'border-orange-500/40 bg-orange-950/40 shadow-[inset_0_1px_0_rgba(251,146,60,0.1)]'
                                                        : 'border-stone-800 bg-stone-900/50 hover:border-stone-700 hover:bg-stone-800/80'
                                                }`}
                                                onClick={() => toggleFormat(freq.value)}
                                                aria-pressed={active}
                                                role="checkbox"
                                                aria-checked={active}
                                                disabled={exporting}
                                            >
                                                <div
                                                    className={`text-sm font-semibold ${active ? 'text-orange-200' : 'text-stone-400'}`}
                                                >
                                                    {freq.label}
                                                </div>
                                                <div
                                                    className={`mt-0.5 text-[10px] ${active ? 'text-orange-400/80' : 'text-stone-600'}`}
                                                >
                                                    {freq.desc}
                                                </div>
                                            </button>
                                        );
                                    })}
                                </div>
                            </DawDialogSection>

                            <DawDialogSection
                                tone="warm"
                                title="Fidelity"
                                detail="Choose sample rate, bit depth, and compression quality."
                                bodyClassName={`grid gap-4 ${formats.has('mp3') ? 'grid-cols-3' : 'grid-cols-2'}`}
                            >
                                <div className="rounded-lg border border-stone-800/50 bg-stone-950/55 p-3">
                                    <DawEyebrowLabel
                                        size="sm"
                                        className="mb-2 block font-bold tracking-widest text-stone-600"
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
                                                        ? 'bg-stone-800 text-stone-200'
                                                        : 'text-stone-500 hover:bg-stone-800/50 hover:text-stone-300'
                                                }`}
                                                onClick={() => updateSampleRate(sr)}
                                                disabled={exporting}
                                            >
                                                {(sr / 1000).toFixed(1)}k
                                            </Button>
                                        ))}
                                    </Row>
                                </div>

                                <div className="rounded-lg border border-stone-800/50 bg-stone-950/55 p-3">
                                    <DawEyebrowLabel
                                        size="sm"
                                        className="mb-2 block font-bold tracking-widest text-stone-600"
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
                                                        ? 'bg-stone-800 text-stone-200'
                                                        : 'text-stone-500 hover:bg-stone-800/50 hover:text-stone-300'
                                                }`}
                                                onClick={() => updateBitDepth(bd)}
                                                disabled={exporting}
                                            >
                                                {bd}-bit
                                            </Button>
                                        ))}
                                    </Row>
                                </div>

                                <div className="rounded-lg border border-stone-800/50 bg-stone-950/55 p-3">
                                    <DawEyebrowLabel
                                        size="sm"
                                        className="mb-2 block font-bold tracking-widest text-stone-600"
                                    >
                                        Loudness
                                    </DawEyebrowLabel>
                                    <Row align="stretch" wrap gap={1}>
                                        {(
                                            [
                                                { value: 'off', label: 'As mixed' },
                                                { value: 'r128', label: `${R128_TARGET_LUFS} LUFS` },
                                            ] as const
                                        ).map((option) => (
                                            <Button
                                                key={option.value}
                                                variant="ghost"
                                                size="sm"
                                                className={`h-6 rounded-md px-2 text-[10px] ${
                                                    normalization === option.value
                                                        ? 'bg-stone-800 text-stone-200'
                                                        : 'text-stone-500 hover:bg-stone-800/50 hover:text-stone-300'
                                                }`}
                                                onClick={() => updateNormalization(option.value)}
                                                disabled={exporting}
                                            >
                                                {option.label}
                                            </Button>
                                        ))}
                                    </Row>
                                    <p className="mt-1.5 text-[10px] text-stone-600">
                                        Measures programme loudness and inter-sample peaks, then applies one gain to
                                        reach the target without exceeding {R128_CEILING_DB_TP} dBTP.
                                    </p>
                                </div>

                                <div className="rounded-lg border border-stone-800/50 bg-stone-950/55 p-3">
                                    <DawEyebrowLabel
                                        size="sm"
                                        className="mb-2 block font-bold tracking-widest text-stone-600"
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
                                                        ? 'bg-stone-800 text-stone-200'
                                                        : 'text-stone-500 hover:bg-stone-800/50 hover:text-stone-300'
                                                }`}
                                                onClick={() => updateDither(option.value)}
                                                disabled={exporting}
                                            >
                                                {option.label}
                                            </Button>
                                        ))}
                                    </Row>
                                    <p className="mt-1.5 text-[10px] text-stone-600">
                                        Repeatable re-exports the same project to identical bytes. Off skips dither
                                        entirely for a bit-exact bounce.
                                    </p>
                                </div>

                                {formats.has('mp3') ? (
                                    <div className="rounded-lg border border-stone-800/50 bg-stone-950/55 p-3">
                                        <DawEyebrowLabel
                                            size="sm"
                                            className="mb-2 block font-bold tracking-widest text-stone-600"
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
                                                            ? 'bg-stone-800 text-stone-200'
                                                            : 'text-stone-500 hover:bg-stone-800/50 hover:text-stone-300'
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
                        <div className="h-10">{renderOvenStatus()}</div>
                    </DawDialogSection>
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
            className={`flex cursor-pointer items-center gap-2 rounded-md border px-2 py-1.5 text-[11px] transition-all ${
                active
                    ? 'border-orange-500/30 bg-orange-950/40 text-orange-200'
                    : 'border-stone-800 bg-stone-900/40 text-stone-400 hover:border-stone-700 hover:text-stone-200'
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
