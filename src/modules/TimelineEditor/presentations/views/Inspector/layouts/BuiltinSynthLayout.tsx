/**
 * Builtin Synth — Dedicated instrument inspector layout.
 *
 * Primary (always visible): Interactive visualizations + core controls
 * Advanced (collapsible): Osc2, sub/noise, modulation, velocity, stereo
 */
import { type ReactElement, useState } from 'react';

import { ChevronDown } from 'lucide-react';

import { DawHeaderBand } from '#/components/daw/DawHeaderBand';
import { ADSREnvelope } from '#/components/daw/visualizers/ADSREnvelope';
import { FilterResponse } from '#/components/daw/visualizers/FilterResponse';
import { OscillatorWaveform } from '#/components/daw/visualizers/OscillatorWaveform';
import { Stack } from '#/components/layout';
import { Button } from '#/components/ui/button';
import { setDeviceParameter } from '#/modules/Arrangement/useCases';

import { SurfaceCard } from '../../../components/Inspector/SurfaceCard';
import { useDeviceParameterGesture } from '../../../hooks/useDeviceParameterGesture';
import { type DeviceLayoutProps, filterParams, registerDeviceLayout } from '../deviceLayoutRegistry';
import { DeviceParameterControl } from '../DeviceParameterControl';
import { FitWidth } from '../FitWidth';
import { ParamCardGrid } from '../ParamCardGrid';
import { SectionHeader } from '../SectionHeader';

const WAVE_NAMES = ['sine', 'triangle', 'sawtooth', 'square'] as const;

type P = DeviceLayoutProps['parameters'][number];

const Param = ({
    param,
    device,
    trackId,
}: {
    param: P;
    device: DeviceLayoutProps['device'];
    trackId: string;
}): ReactElement => (
    <SurfaceCard className="rounded-md bg-surface-base p-2 w-full">
        <DeviceParameterControl param={param} device={device} trackId={trackId} />
    </SurfaceCard>
);

const Row2 = ({
    ids,
    params,
    device,
    trackId,
}: {
    ids: string[];
    params: P[];
    device: DeviceLayoutProps['device'];
    trackId: string;
}): ReactElement => (
    <ParamCardGrid>
        {filterParams(params, ids).map((param) => (
            <Param key={param.id} param={param} device={device} trackId={trackId} />
        ))}
    </ParamCardGrid>
);

const Collapsible = ({
    title,
    defaultOpen,
    children,
}: {
    title: string;
    defaultOpen: boolean;
    children: ReactElement;
}): ReactElement => {
    const [open, setOpen] = useState(defaultOpen);
    return (
        <div>
            <DawHeaderBand compact className="mb-2 rounded-sm hover:bg-surface-raised/50">
                <Button
                    variant="bare"
                    size="bare"
                    type="button"
                    className="flex w-full items-center gap-1"
                    onClick={() => setOpen(!open)}
                    aria-expanded={open}
                >
                    <ChevronDown
                        className={`size-3 text-muted-foreground transition-transform ${open ? '' : '-rotate-90'}`}
                    />
                    <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                        {title}
                    </span>
                </Button>
            </DawHeaderBand>
            {open ? children : null}
        </div>
    );
};

type EnvelopeStage = 'attack' | 'decay' | 'sustain' | 'release';

const InteractiveSynthEnvelope = ({
    device,
    trackId,
    stages,
    width,
}: Pick<DeviceLayoutProps, 'device' | 'trackId'> & {
    stages: Record<EnvelopeStage, P>;
    width: number;
}): ReactElement => {
    const attack = useDeviceParameterGesture({ param: stages.attack, device, trackId });
    const decay = useDeviceParameterGesture({ param: stages.decay, device, trackId });
    const sustain = useDeviceParameterGesture({ param: stages.sustain, device, trackId });
    const release = useDeviceParameterGesture({ param: stages.release, device, trackId });
    const gestures = { attack, decay, sustain, release };

    return (
        <ADSREnvelope
            attack={attack.value}
            decay={decay.value}
            sustain={sustain.value}
            release={release.value}
            width={width}
            height={80}
            onParamChange={(stage, value) => {
                if (stage === 'attack' || stage === 'decay' || stage === 'sustain' || stage === 'release') {
                    gestures[stage].change(value, true);
                }
            }}
            onGestureStart={(stage) => gestures[stage].isGestureCurrent(gestures[stage].startGesture())}
            onGestureCommit={(stage) => gestures[stage].settleGesture()}
            onGestureCancel={(stage) => gestures[stage].cancel()}
        />
    );
};

const SynthEnvelope = ({ device, trackId, parameters, width }: DeviceLayoutProps & { width: number }): ReactElement => {
    const attack = parameters.find((param) => param.id === 'attack');
    const decay = parameters.find((param) => param.id === 'decay');
    const sustain = parameters.find((param) => param.id === 'sustain');
    const release = parameters.find((param) => param.id === 'release');
    if (!attack || !decay || !sustain || !release) {
        return (
            <ADSREnvelope
                attack={device.parameterValues.attack ?? attack?.value ?? 0.01}
                decay={device.parameterValues.decay ?? decay?.value ?? 0.2}
                sustain={device.parameterValues.sustain ?? sustain?.value ?? 0.7}
                release={device.parameterValues.release ?? release?.value ?? 0.3}
                width={width}
                height={80}
            />
        );
    }
    return (
        <InteractiveSynthEnvelope
            device={device}
            trackId={trackId}
            stages={{ attack, decay, sustain, release }}
            width={width}
        />
    );
};

const BuiltinSynthLayout = ({ device, trackId, parameters }: DeviceLayoutProps): ReactElement => {
    const pv = device.parameterValues;
    const wf1Idx = Math.round(pv.waveform ?? 2);
    const wf2Idx = Math.round(pv.osc2Waveform ?? 2);
    const waveform = WAVE_NAMES[wf1Idx] ?? 'sawtooth';
    const osc2Waveform = WAVE_NAMES[wf2Idx] ?? 'sawtooth';

    const change = (id: string, value: number): void => {
        setDeviceParameter(device.id, id, value);
    };

    return (
        <Stack gap={4}>
            {/* ═══ PRIMARY: Always visible ═══ */}
            {/* Oscillator */}
            <div>
                <SectionHeader title="Oscillator" />
                <FitWidth fallbackWidth={200} className="mb-3">
                    {(width) => (
                        <OscillatorWaveform
                            waveform={waveform}
                            osc2Waveform={osc2Waveform}
                            osc2Mix={pv.osc2Mix ?? 0}
                            detune={pv.osc2Detune ?? 0}
                            width={width}
                            height={60}
                        />
                    )}
                </FitWidth>
                <Row2 ids={['waveform', 'detune']} params={parameters} device={device} trackId={trackId} />
            </div>
            {/* Filter — interactive */}
            <div>
                <SectionHeader title="Filter" />
                <FitWidth fallbackWidth={200} className="mb-3">
                    {(width) => (
                        <FilterResponse
                            cutoff={pv.filterCutoff ?? 5000}
                            resonance={pv.filterResonance ?? 1}
                            filterType={pv.filterType ?? 0}
                            width={width}
                            height={70}
                            onParamChange={change}
                        />
                    )}
                </FitWidth>
                <Row2 ids={['filterCutoff', 'filterResonance']} params={parameters} device={device} trackId={trackId} />
            </div>
            <div>
                <SectionHeader title="Envelope" />
                <FitWidth fallbackWidth={200} className="mb-3">
                    {(width) => (
                        <SynthEnvelope device={device} trackId={trackId} parameters={parameters} width={width} />
                    )}
                </FitWidth>
                <Row2 ids={['attack', 'decay']} params={parameters} device={device} trackId={trackId} />
                <div className="mt-2">
                    <Row2 ids={['sustain', 'release']} params={parameters} device={device} trackId={trackId} />
                </div>
            </div>
            {/* Gain — always visible */}
            {filterParams(parameters, ['gain']).map((param) => (
                <Param key={param.id} param={param} device={device} trackId={trackId} />
            ))}
            {/* ═══ ADVANCED: Collapsible ═══ */}
            <Collapsible title="Oscillator 2" defaultOpen={false}>
                <Stack gap={2}>
                    <Row2 ids={['osc2Waveform', 'osc2Detune']} params={parameters} device={device} trackId={trackId} />
                    <Row2 ids={['osc2Mix', 'stereoSpread']} params={parameters} device={device} trackId={trackId} />
                </Stack>
            </Collapsible>
            <Collapsible title="Sub & Noise" defaultOpen={false}>
                <Row2 ids={['subOscLevel', 'noiseLevel']} params={parameters} device={device} trackId={trackId} />
            </Collapsible>
            <Collapsible title="Filter Advanced" defaultOpen={false}>
                <Stack gap={2}>
                    {filterParams(parameters, ['filterType']).map((param) => (
                        <Param key={param.id} param={param} device={device} trackId={trackId} />
                    ))}
                    <Row2
                        ids={['filterEnvAmount', 'filterVelocitySensitivity']}
                        params={parameters}
                        device={device}
                        trackId={trackId}
                    />
                </Stack>
            </Collapsible>
            <Collapsible title="Modulation" defaultOpen={false}>
                <Stack gap={2}>
                    <Row2 ids={['vibratoRate', 'vibratoDepth']} params={parameters} device={device} trackId={trackId} />
                    {filterParams(parameters, ['vibratoDelay']).map((param) => (
                        <Param key={param.id} param={param} device={device} trackId={trackId} />
                    ))}
                </Stack>
            </Collapsible>
        </Stack>
    );
};

registerDeviceLayout(
    [
        'builtin-synth',
        'builtin-synth-mellotron',
        'builtin-synth-strings',
        'builtin-synth-808bass',
        'builtin-synth-brass',
    ],
    BuiltinSynthLayout
);
