/**
 * Top-level Sampler panel view.
 * Composes WaveformDisplay, PadGrid, SliceOverlay, and SamplerControls
 * into the full sampler interface.
 */

import { type ReactElement, useEffect, useState, useSyncExternalStore } from 'react';
import { Circle, Cpu, Volume2 } from 'lucide-react';
import { DawPluginLed } from '#/components/daw/DawPluginLed';
import { DawPluginMetricTile } from '#/components/daw/DawPluginMetricTile';
import { DawPluginSectionCard } from '#/components/daw/DawPluginSectionCard';
import { midiNoteToName } from '../../models/SamplerTypes';
import {
    samplerStore,
    setFilterParams,
    setMasterGain,
    setPan,
    setTune,
    updateEnvelope,
    type SamplerState,
} from '../../stores/samplerStore';
import { padStore, reorderPad, selectPad, type PadState } from '../../stores/padStore';
import { sliceStore, setActiveSlice, type SliceState } from '../../stores/sliceStore';
import { setSamplerParamThrottled } from '../../useCases/samplerParamBridge';
import { switchSamplerMode } from '../../useCases/setSamplerMode';
import { triggerPadOn } from '../../useCases/triggerPad';
import { handleSamplerFileDrop } from '../../useCases/handleFileDrop';
import { subscribeToPosition } from '../../useCases/positionTracking';
import { debouncedUpdateMarkerPosition, detectAndSetSlices } from '../../useCases/updateSliceMarker';
import { armSamplerRecording, stopSamplerRecording } from '../../useCases/recording';
import { detectAndApplyLoopPoints } from '../../useCases/smartLoopPoints';
import { updateVoiceStack } from '../../useCases/voiceStacking';
import { PadGrid } from '../components/PadGrid';
import { SamplerControls } from '../components/SamplerControls';
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
        className="sampler-window"
        title={title}
        detail={detail}
        titleClassName="text-[var(--color-accent-peach)]/70"
    >
        {children}
    </DawPluginSectionCard>
);

export const SamplerPanel = ({ deviceId }: { deviceId: string }): ReactElement => {
    const state = useSyncExternalStore<SamplerState | null>(
        (cb) => samplerStore.subscribe(cb),
        () => samplerStore.value
    );
    const pads = useSyncExternalStore<PadState | null>(
        (cb) => padStore.subscribe(cb),
        () => padStore.value
    );
    const slices = useSyncExternalStore<SliceState | null>(
        (cb) => sliceStore.subscribe(cb),
        () => sliceStore.value
    );

    if (!state || !pads) {
        return <div className="h-full" />;
    }

    const { activeSample, mode, envelope, filterCutoff, filterResonance, filterType, masterGain, tune, pan, activeVoices, isLoading, voiceStack } = state;

    // Use deviceId as the engine instance identifier for IPC.
    const instanceId = state.instanceId ?? deviceId;

    const [isDragOver, setIsDragOver] = useState(false);
    const [playbackFrame, setPlaybackFrame] = useState(0);
    const [isRecording, setIsRecording] = useState(false);

    useEffect(() => {
        return subscribeToPosition(setPlaybackFrame);
    }, []);

    function handleParamChange(param: string, value: number): void {
        setSamplerParamThrottled(instanceId, param, value);
    }

    return (
        <div
            className="sampler-faceplate relative h-full min-h-0 overflow-hidden rounded-[26px] p-3"
            onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'copy';
                setIsDragOver(true);
            }}
            onDragLeave={() => setIsDragOver(false)}
            onDrop={(e) => {
                setIsDragOver(false);
                handleSamplerFileDrop(e);
            }}
        >
            {isDragOver ? (
                <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-[26px] border-2 border-dashed border-[var(--color-accent-peach)] bg-[var(--color-accent-peach)]/5">
                    <span className="text-sm font-medium text-[var(--color-accent-peach)]">
                        Drop sample here
                    </span>
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
                                        className="sampler-window min-w-[80px]"
                                        label="Rate"
                                        value={`${(activeSample.sampleRate / 1000).toFixed(1)}k`}
                                        detail="Sample rate"
                                    />
                                    <DawPluginMetricTile
                                        className="sampler-window min-w-[80px]"
                                        label="Duration"
                                        value={`${activeSample.durationSecs.toFixed(2)}s`}
                                        detail="Length"
                                    />
                                    <DawPluginMetricTile
                                        className="sampler-window min-w-[80px]"
                                        label="Root"
                                        value={activeSample.detectedRoot !== null ? midiNoteToName(activeSample.detectedRoot) : '—'}
                                        detail="Detected pitch"
                                    />
                                    <DawPluginMetricTile
                                        className="sampler-window min-w-[80px]"
                                        label="BPM"
                                        value={activeSample.detectedBpm !== null ? `${activeSample.detectedBpm.toFixed(1)}` : '—'}
                                        detail="Estimated tempo"
                                    />
                                    <DawPluginMetricTile
                                        className="sampler-window min-w-[80px]"
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
                                onSelectPad={selectPad}
                                onTriggerPad={(index) => triggerPadOn(index, 100)}
                                onReorderPad={reorderPad}
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
                                            armSamplerRecording(0.01, pads.selectedPadIndex, 60);
                                        }}
                                    >
                                        Arm
                                    </button>
                                    <button
                                        type="button"
                                        className="rounded-md bg-white/[0.06] px-3 py-1.5 text-[10px] font-medium text-foreground/80 transition-colors hover:bg-white/[0.1]"
                                        onClick={() => {
                                            setIsRecording(false);
                                            stopSamplerRecording();
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
                            <DawPluginLed tone="peach" className="flex items-center gap-1">
                                <Cpu className="size-3" />
                                {activeVoices} voices
                            </DawPluginLed>
                            <DawPluginLed tone="peach" className="flex items-center gap-1">
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
                                peaks={state.waveformPeaks}
                                totalFrames={activeSample?.frameCount ?? 0}
                                playbackFrame={playbackFrame}
                                height={140}
                            />
                            {mode === 'slice' && slices && activeSample ? (
                                <SliceOverlay
                                    markers={slices.markers}
                                    totalFrames={activeSample.frameCount}
                                    activeSliceIndex={slices.activeSliceIndex}
                                    width={600}
                                    height={140}
                                    onMarkerDrag={debouncedUpdateMarkerPosition}
                                    onSelectSlice={setActiveSlice}
                                />
                            ) : null}
                        </div>
                    </SectionCard>

                    {mode === 'slice' ? (
                        <SectionCard title="Slices" detail={`${slices?.markers.length ?? 0} markers`}>
                            <button
                                type="button"
                                className="rounded-md bg-white/[0.06] px-3 py-1.5 text-[10px] font-medium text-foreground/80 transition-colors hover:bg-white/[0.1]"
                                onClick={() => detectAndSetSlices('superflux')}
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
                                onClick={() => detectAndApplyLoopPoints()}
                            >
                                Detect loop points
                            </button>
                        </SectionCard>
                    ) : null}
                </section>

                {/* Right rail — Controls */}
                <aside className="flex min-h-0 flex-col gap-3 overflow-y-auto pr-1">
                    <SectionCard title="Controls" detail="Mode, envelope, filter, and output parameters">
                        <SamplerControls
                            mode={mode}
                            envelope={envelope}
                            filterCutoff={filterCutoff}
                            filterResonance={filterResonance}
                            filterType={filterType}
                            masterGain={masterGain}
                            tune={tune}
                            pan={pan}
                            voiceStack={voiceStack}
                            onModeChange={(m) => switchSamplerMode(m)}
                            onEnvelopeChange={(updates) => {
                                updateEnvelope(updates);
                                for (const [key, value] of Object.entries(updates)) {
                                    handleParamChange(key, value);
                                }
                            }}
                            onFilterChange={(cutoff, resonance) => {
                                setFilterParams(cutoff, resonance);
                                if (cutoff !== undefined) handleParamChange('filterCutoff', cutoff);
                                if (resonance !== undefined) handleParamChange('filterResonance', resonance);
                            }}
                            onGainChange={(gain) => {
                                setMasterGain(gain);
                                handleParamChange('masterGain', gain);
                            }}
                            onTuneChange={(t) => {
                                setTune(t);
                                handleParamChange('tune', t);
                            }}
                            onPanChange={(p) => {
                                setPan(p);
                                handleParamChange('pan', p);
                            }}
                            onStackChange={(updates) => updateVoiceStack(updates)}
                        />
                    </SectionCard>
                </aside>
            </div>
        </div>
    );
};
