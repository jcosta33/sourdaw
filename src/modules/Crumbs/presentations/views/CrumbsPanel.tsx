/**
 * Top-level Crumbs panel view.
 * Composes WaveformDisplay, PadGrid, SliceOverlay, and CrumbsControls
 * into the full crumbs interface.
 */

import { type ReactElement, useEffect, useState } from 'react';

import { Circle, Cpu, Volume2 } from 'lucide-react';

import { DawPluginLed } from '#/components/daw/DawPluginLed';
import { DawPluginMetricTile } from '#/components/daw/DawPluginMetricTile';
import { DawPluginSectionCard } from '#/components/daw/DawPluginSectionCard';
import { logger } from '#/infra/logger/appLogger';
import { useStoreSelector } from '#/infra/store/useStoreSelector';
import { trackStore, type TrackStoreState } from '#/modules/Arrangement/stores';

import { midiNoteToName } from '../../models/CrumbsTypes';
import { defaultCrumbsState, crumbsStore } from '../../stores/crumbsStore';
import { defaultPadState, padStore, ensurePadInstance, reorderPad, selectPad } from '../../stores/padStore';
import { defaultSliceState, sliceStore, ensureSliceInstance, setActiveSlice } from '../../stores/sliceStore';
import { ensureCrumbsInstanceFromProject } from '../../useCases/crumbsLifecycle/ensureCrumbsInstanceFromProject';
import { initCrumbsEngine } from '../../useCases/crumbsLifecycle/initCrumbsEngine';
import { teardownCrumbsEngine } from '../../useCases/crumbsLifecycle/teardownCrumbsEngine';
import { handleCrumbsFileDrop } from '../../useCases/handleFileDrop';
import { hydrateCrumbsParametersFromProject } from '../../useCases/hydrateCrumbsParametersFromProject';
import { subscribeToPosition } from '../../useCases/positionTracking';
import { armCrumbsRecording } from '../../useCases/recording/armCrumbsRecording';
import { stopCrumbsRecording } from '../../useCases/recording/stopCrumbsRecording';
import { switchCrumbsMode } from '../../useCases/setCrumbsMode';
import { setCrumbsParamWithAudio } from '../../useCases/setCrumbsParamWithAudio';
import { detectAndApplyLoopPoints } from '../../useCases/smartLoopPoints';
import { triggerPadOff } from '../../useCases/triggerPad/triggerPadOff';
import { triggerPadOn } from '../../useCases/triggerPad/triggerPadOn';
import { debouncedUpdateMarkerPosition } from '../../useCases/updateSliceMarker/debouncedUpdateMarkerPosition';
import { detectAndSetSlices } from '../../useCases/updateSliceMarker/detectAndSetSlices';
import { updateVoiceStack } from '../../useCases/voiceStacking';
import { CrumbsControls } from '../components/CrumbsControls';
import { PadGrid } from '../components/PadGrid';
import { SliceOverlay } from '../components/SliceOverlay';
import { WaveformDisplay } from '../components/WaveformDisplay';

const SectionCard = ({
    title,
    detail,
    children,
}: {
    title: string;
    detail?: string;
    children: ReactElement | ReactElement[];
}): ReactElement => (
    <DawPluginSectionCard
        className="crumbs-window"
        title={title}
        detail={detail}
        titleClassName="text-[var(--color-accent-lavender)]/70"
    >
        {children}
    </DawPluginSectionCard>
);

function selectProjectParameterValues(state: TrackStoreState | null, deviceId: string): Record<string, number> | null {
    for (const track of state?.tracks ?? []) {
        const device = track.devices.find((candidate) => candidate.id === deviceId);
        if (device) {
            return device.parameterValues;
        }
    }
    return null;
}

export const CrumbsPanel = ({ deviceId }: { deviceId: string }): ReactElement => {
    // §209.1 — Typed defaults instead of non-null assertion on live values.
    const state = useStoreSelector(crumbsStore, (s) => s?.[deviceId] ?? defaultCrumbsState);
    const pads = useStoreSelector(padStore, (s) => s?.[deviceId] ?? defaultPadState);
    const slices = useStoreSelector(sliceStore, (s) => s?.[deviceId] ?? defaultSliceState);
    const projectParameterValues = useStoreSelector(trackStore, (project) =>
        selectProjectParameterValues(project, deviceId)
    );

    const [isDragOver, setIsDragOver] = useState(false);
    const [isRecording, setIsRecording] = useState(false);
    // null = still initializing, true = engine ready, false = engine unavailable.
    // Gates the status LED so a failed init can't read 'Ready' while param writes
    // silently no-op against a missing backend instance.
    const [engineReady, setEngineReady] = useState<boolean | null>(null);
    // Reset the gate to 'initializing' when the panel is pointed at a new device:
    // done during render via the previous-prop pattern (react.dev "storing
    // information from previous renders") rather than synchronously in the effect
    // body, which would trigger a cascading re-render.
    const [prevDeviceId, setPrevDeviceId] = useState(deviceId);
    if (prevDeviceId !== deviceId) {
        setPrevDeviceId(deviceId);
        setEngineReady(null);
    }

    // Create / destroy crumbs engine instance on mount/unmount.
    useEffect(() => {
        let cancelled = false;
        // Seeded from project truth, not from the module default: on a reload the
        // panel can mount before the engine chain is built, and a default entry
        // written first would shadow the saved sample for the rest of the session.
        ensureCrumbsInstanceFromProject(deviceId);
        ensurePadInstance(deviceId);
        ensureSliceInstance(deviceId);

        initCrumbsEngine(deviceId, 44100)
            .then(() => {
                if (!cancelled) {
                    setEngineReady(true);
                }
                return undefined;
            })
            .catch((error) => {
                logger.warn('Failed to create crumbs instance:', error);
                if (!cancelled) {
                    setEngineReady(false);
                }
            });
        return () => {
            cancelled = true;
            teardownCrumbsEngine(deviceId).catch((error) => {
                logger.warn('Failed to destroy crumbs instance:', error);
            });
        };
    }, [deviceId]);

    useEffect(() => {
        if (projectParameterValues) {
            hydrateCrumbsParametersFromProject(deviceId);
        }
    }, [deviceId, projectParameterValues]);

    if (!state || !pads) {
        return <div className="h-full" />;
    }

    const {
        activeSample,
        mode,
        envelope,
        filterCutoff,
        filterResonance,
        filterType,
        masterGain,
        tune,
        pan,
        activeVoices,
        isLoading,
        voiceStack,
    } = state;

    let statusLabel = 'Ready';
    if (engineReady === false) {
        statusLabel = 'Engine unavailable';
    } else if (engineReady === null || isLoading) {
        statusLabel = 'Loading...';
    }

    return (
        <div
            className="crumbs-faceplate relative h-full min-h-0 overflow-hidden rounded-[26px] p-3"
            onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'copy';
                setIsDragOver(true);
            }}
            onDragLeave={() => setIsDragOver(false)}
            onDrop={(e) => {
                setIsDragOver(false);
                void handleCrumbsFileDrop(deviceId, e.nativeEvent);
            }}
        >
            {isDragOver ? (
                <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-[26px] border-2 border-dashed border-[var(--color-accent-lavender)] bg-[var(--color-accent-lavender)]/5">
                    <span className="text-sm font-medium text-[var(--color-accent-lavender)]">Drop sample here</span>
                </div>
            ) : null}
            <div className="grid h-full min-h-0 grid-cols-[18rem_minmax(0,1fr)_17rem] gap-3">
                {/* Left rail — Pad grid + selected pad info */}
                <aside className="flex min-h-0 flex-col gap-3 overflow-y-auto pr-1">
                    <SectionCard title="Sample" detail={activeSample?.fileName ?? 'No sample loaded'}>
                        <div className="flex flex-wrap gap-2">
                            {activeSample ? (
                                <>
                                    <DawPluginMetricTile
                                        className="crumbs-window min-w-[80px]"
                                        label="Rate"
                                        value={`${(activeSample.sampleRate / 1000).toFixed(1)}k`}
                                        detail="Sample rate"
                                    />
                                    <DawPluginMetricTile
                                        className="crumbs-window min-w-[80px]"
                                        label="Duration"
                                        value={`${activeSample.durationSecs.toFixed(2)}s`}
                                        detail="Length"
                                    />
                                    <DawPluginMetricTile
                                        className="crumbs-window min-w-[80px]"
                                        label="Root"
                                        value={
                                            activeSample.detectedRoot !== null
                                                ? midiNoteToName(activeSample.detectedRoot)
                                                : '—'
                                        }
                                        detail="Detected pitch"
                                    />
                                    <DawPluginMetricTile
                                        className="crumbs-window min-w-[80px]"
                                        label="BPM"
                                        value={
                                            activeSample.detectedBpm !== null
                                                ? `${activeSample.detectedBpm.toFixed(1)}`
                                                : '—'
                                        }
                                        detail="Estimated tempo"
                                    />
                                    <DawPluginMetricTile
                                        className="crumbs-window min-w-[80px]"
                                        label="Type"
                                        value={activeSample.category}
                                        detail="Classification"
                                    />
                                </>
                            ) : (
                                <div className="py-4 text-center text-[10px] text-muted-foreground/50">
                                    Drop a sample to begin
                                </div>
                            )}
                        </div>
                    </SectionCard>

                    {mode === 'drum' ? (
                        <SectionCard title="Pad bay" detail="Trigger pads to play samples">
                            <PadGrid
                                pads={pads.pads}
                                selectedIndex={pads.selectedPadIndex}
                                onSelectPad={(index) => selectPad(deviceId, index)}
                                onTriggerPad={(index) => triggerPadOn(deviceId, index, 100)}
                                onTriggerPadOff={(index) => triggerPadOff(deviceId, index)}
                                onReorderPad={(from, to) => reorderPad(deviceId, from, to)}
                            />
                        </SectionCard>
                    ) : null}

                    {mode === 'record' ? (
                        <SectionCard title="Recorder" detail="SP-404 style threshold capture">
                            <div className="flex flex-col gap-2">
                                <div className="flex items-center gap-2">
                                    <Circle
                                        className={`size-3 ${isRecording ? 'fill-red-500 text-red-500' : 'fill-none text-foreground/40'}`}
                                    />
                                    <span className="text-[10px] text-foreground/70">
                                        {isRecording ? 'Recording...' : 'Idle'}
                                    </span>
                                </div>
                                <div className="flex gap-2">
                                    <button
                                        type="button"
                                        className="rounded-md bg-white/[0.06] px-3 py-1.5 text-[10px] font-medium text-foreground/80 transition-colors hover:bg-white/[0.1]"
                                        onClick={() => {
                                            // The readout follows the arm's
                                            // outcome, never the click: a
                                            // refused arm must not read
                                            // "Recording..." over a take that
                                            // was never opened.
                                            armCrumbsRecording(deviceId, 0.01, pads.selectedPadIndex, 60)
                                                .then((armed) => {
                                                    setIsRecording(armed);
                                                    return undefined;
                                                })
                                                .catch((error: unknown) => {
                                                    logger.warn('Failed to arm crumbs recording:', error);
                                                    setIsRecording(false);
                                                });
                                        }}
                                    >
                                        Arm
                                    </button>
                                    <button
                                        type="button"
                                        className="rounded-md bg-white/[0.06] px-3 py-1.5 text-[10px] font-medium text-foreground/80 transition-colors hover:bg-white/[0.1]"
                                        onClick={() => {
                                            // Stop reads Idle at once — the
                                            // user asked for it — but a
                                            // refusal is reported rather than
                                            // swallowed by a bare `void`.
                                            setIsRecording(false);
                                            stopCrumbsRecording(deviceId).catch((error: unknown) => {
                                                logger.warn('Failed to stop crumbs recording:', error);
                                            });
                                        }}
                                    >
                                        Stop
                                    </button>
                                </div>
                            </div>
                        </SectionCard>
                    ) : null}

                    <SectionCard title="Status">
                        <div className="flex items-center gap-3">
                            <DawPluginLed tone="lavender" className="flex items-center gap-1">
                                <Cpu className="size-3" />
                                {activeVoices} voices
                            </DawPluginLed>
                            <DawPluginLed
                                tone={engineReady === false ? 'danger' : 'lavender'}
                                className="flex items-center gap-1"
                            >
                                <Volume2 className="size-3" />
                                {statusLabel}
                            </DawPluginLed>
                        </div>
                    </SectionCard>
                </aside>

                {/* Center — Waveform + slice overlay */}
                <section className="flex min-h-0 min-w-0 flex-col gap-3 overflow-y-auto pr-1">
                    <SectionCard title="Waveform">
                        <div className="relative">
                            <WaveformDisplay
                                instanceId={deviceId}
                                peaks={state.waveformPeaks}
                                totalFrames={activeSample?.frameCount ?? 0}
                                onPositionSubscribe={subscribeToPosition}
                                height={140}
                            />
                            {mode === 'slice' && slices && activeSample ? (
                                <SliceOverlay
                                    markers={slices.markers}
                                    totalFrames={activeSample.frameCount}
                                    activeSliceIndex={slices.activeSliceIndex}
                                    height={140}
                                    onMarkerDrag={(id, pos) => debouncedUpdateMarkerPosition(deviceId, id, pos)}
                                    onSelectSlice={(index) => setActiveSlice(deviceId, index)}
                                />
                            ) : null}
                        </div>
                    </SectionCard>

                    {mode === 'slice' ? (
                        <SectionCard title="Slices" detail={`${slices?.markers.length ?? 0} markers`}>
                            <button
                                type="button"
                                className="rounded-md bg-white/[0.06] px-3 py-1.5 text-[10px] font-medium text-foreground/80 transition-colors hover:bg-white/[0.1]"
                                onClick={() => detectAndSetSlices(deviceId, 'superflux')}
                            >
                                Auto-detect slices
                            </button>
                        </SectionCard>
                    ) : null}

                    {activeSample ? (
                        <SectionCard title="Loop" detail="Smart loop point detection">
                            <button
                                type="button"
                                className="rounded-md bg-white/[0.06] px-3 py-1.5 text-[10px] font-medium text-foreground/80 transition-colors hover:bg-white/[0.1]"
                                onClick={() => detectAndApplyLoopPoints(deviceId)}
                            >
                                Detect loop points
                            </button>
                        </SectionCard>
                    ) : null}
                </section>

                {/* Right rail — Controls */}
                <aside className="flex min-h-0 flex-col gap-3 overflow-y-auto pr-1">
                    <SectionCard title="Controls" detail="Mode, envelope, filter, and output parameters">
                        <CrumbsControls
                            mode={mode}
                            envelope={envelope}
                            filterCutoff={filterCutoff}
                            filterResonance={filterResonance}
                            filterType={filterType}
                            masterGain={masterGain}
                            tune={tune}
                            pan={pan}
                            voiceStack={voiceStack}
                            onModeChange={(m) => switchCrumbsMode(deviceId, m)}
                            onParamChange={(paramId, value, isTransient) =>
                                setCrumbsParamWithAudio(deviceId, paramId, value, isTransient)
                            }
                            onStackChange={(updates, isTransient) => updateVoiceStack(deviceId, updates, isTransient)}
                        />
                    </SectionCard>
                </aside>
            </div>
        </div>
    );
};
