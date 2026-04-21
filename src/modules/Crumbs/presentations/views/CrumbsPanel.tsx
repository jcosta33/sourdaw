/**
 * Top-level Crumbs panel view.
 * Composes WaveformDisplay, PadGrid, SliceOverlay, and CrumbsControls
 * into the full crumbs interface.
 */

import { type ReactElement, useEffect, useState, useCallback } from 'react';

import { Circle, Cpu, Volume2 } from 'lucide-react';

import { DawPluginLed } from '#/components/daw/DawPluginLed';
import { DawPluginMetricTile } from '#/components/daw/DawPluginMetricTile';
import { DawPluginSectionCard } from '#/components/daw/DawPluginSectionCard';
import { logger } from '#/infra/logger/appLogger';
import { useStoreSelector } from '#/infra/store/useStoreSelector';

import { midiNoteToName } from '../../models/CrumbsTypes';
import {
    defaultCrumbsState,
    crumbsStore,
    ensureInstance,
    setFilterParams,
    setMasterGain,
    setPan,
    setTune,
    updateEnvelope,
} from '../../stores/crumbsStore';
import { defaultPadState, padStore, ensurePadInstance, reorderPad, selectPad } from '../../stores/padStore';
import { defaultSliceState, sliceStore, ensureSliceInstance, setActiveSlice } from '../../stores/sliceStore';
import { initCrumbsEngine } from '../../useCases/crumbsLifecycle/initCrumbsEngine';
import { teardownCrumbsEngine } from '../../useCases/crumbsLifecycle/teardownCrumbsEngine';
import { setCrumbsParamThrottled } from '../../useCases/crumbsParamBridge/setCrumbsParamThrottled';
import { handleCrumbsFileDrop } from '../../useCases/handleFileDrop';
import { subscribeToPosition } from '../../useCases/positionTracking';
import { armCrumbsRecording } from '../../useCases/recording/armCrumbsRecording';
import { stopCrumbsRecording } from '../../useCases/recording/stopCrumbsRecording';
import { switchCrumbsMode } from '../../useCases/setCrumbsMode';
import { detectAndApplyLoopPoints } from '../../useCases/smartLoopPoints';
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

export const CrumbsPanel = ({ deviceId }: { deviceId: string }): ReactElement => {
    // §209.1 — Typed defaults instead of non-null assertion on live values.
    const state = useStoreSelector(
        crumbsStore,
        useCallback((s) => s?.[deviceId] ?? defaultCrumbsState, [deviceId])
    );
    const pads = useStoreSelector(
        padStore,
        useCallback((s) => s?.[deviceId] ?? defaultPadState, [deviceId])
    );
    const slices = useStoreSelector(
        sliceStore,
        useCallback((s) => s?.[deviceId] ?? defaultSliceState, [deviceId])
    );

    // Create / destroy crumbs engine instance on mount/unmount.
    useEffect(() => {
        ensureInstance(deviceId);
        ensurePadInstance(deviceId);
        ensureSliceInstance(deviceId);

        initCrumbsEngine(deviceId, 44100).catch((error) => {
            logger.warn('Failed to create crumbs instance:', error);
        });
        return () => {
            teardownCrumbsEngine(deviceId).catch((error) => {
                logger.warn('Failed to destroy crumbs instance:', error);
            });
        };
    }, [deviceId]);

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

    const [isDragOver, setIsDragOver] = useState(false);
    const [isRecording, setIsRecording] = useState(false);

    function handleParamChange(param: string, value: number): void {
        setCrumbsParamThrottled(deviceId, param, value);
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
                void handleCrumbsFileDrop(deviceId, e);
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
                                            setIsRecording(true);
                                            void armCrumbsRecording(deviceId, 0.01, pads.selectedPadIndex, 60);
                                        }}
                                    >
                                        Arm
                                    </button>
                                    <button
                                        type="button"
                                        className="rounded-md bg-white/[0.06] px-3 py-1.5 text-[10px] font-medium text-foreground/80 transition-colors hover:bg-white/[0.1]"
                                        onClick={() => {
                                            setIsRecording(false);
                                            void stopCrumbsRecording(deviceId);
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
                            <DawPluginLed tone="lavender" className="flex items-center gap-1">
                                <Volume2 className="size-3" />
                                {isLoading ? 'Loading...' : 'Ready'}
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
                                    width={600}
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
                            onEnvelopeChange={(updates) => {
                                updateEnvelope(deviceId, updates);
                                for (const [key, value] of Object.entries(updates)) {
                                    handleParamChange(key, value);
                                }
                            }}
                            onFilterChange={(cutoff, resonance) => {
                                setFilterParams(deviceId, cutoff, resonance);
                                if (cutoff !== undefined) {
                                    handleParamChange('filterCutoff', cutoff);
                                }
                                if (resonance !== undefined) {
                                    handleParamChange('filterResonance', resonance);
                                }
                            }}
                            onGainChange={(gain) => {
                                setMasterGain(deviceId, gain);
                                handleParamChange('masterGain', gain);
                            }}
                            onTuneChange={(t) => {
                                setTune(deviceId, t);
                                handleParamChange('tune', t);
                            }}
                            onPanChange={(p) => {
                                setPan(deviceId, p);
                                handleParamChange('pan', p);
                            }}
                            onStackChange={(updates) => updateVoiceStack(deviceId, updates)}
                        />
                    </SectionCard>
                </aside>
            </div>
        </div>
    );
};
