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
import { Grid, Row, Stack } from '#/components/layout';
import { Button } from '#/components/ui/button';
import { setDeviceParameter } from '#/modules/Arrangement/useCases';

import { SurfaceCard } from '../../../components/Inspector/SurfaceCard';
import { useDeviceParameterGesture } from '../../../hooks/useDeviceParameterGesture';
import { type DeviceLayoutProps, filterParams, registerDeviceLayout } from '../deviceLayoutRegistry';
import { DeviceParameterControl } from '../DeviceParameterControl';
import { SectionHeader } from '../SectionHeader';

const WAVE_NAMES = ['sine', 'triangle', 'sawtooth', 'square'] as const;

type P = DeviceLayoutProps['parameters'][number];

const Param = ({
    param,
    device,
    trackId,
    previewValue,
}: {
    param: P;
    device: DeviceLayoutProps['device'];
    trackId: string;
    previewValue?: number;
}): ReactElement => (
    <SurfaceCard className="rounded-md bg-surface-base p-2 w-full">
        <DeviceParameterControl param={param} device={device} trackId={trackId} previewValue={previewValue} />
    </SurfaceCard>
);

const Row2 = ({
    ids,
    params,
    device,
    trackId,
    previewValues,
}: {
    ids: string[];
    params: P[];
    device: DeviceLayoutProps['device'];
    trackId: string;
    previewValues?: Partial<Record<string, number>>;
}): ReactElement => (
    <Grid cols={2} gap={2}>
        {filterParams(params, ids).map((param) => (
            <Param
                key={param.id}
                param={param}
                device={device}
                trackId={trackId}
                previewValue={previewValues?.[param.id]}
            />
        ))}
    </Grid>
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

const SynthEnvelopeSection = ({ device, trackId, parameters }: DeviceLayoutProps): ReactElement => {
    const attackGesture = useDeviceParameterGesture({
        param: parameters.find((param) => param.id === 'attack'),
        device,
        trackId,
    });
    const decayGesture = useDeviceParameterGesture({
        param: parameters.find((param) => param.id === 'decay'),
        device,
        trackId,
    });
    const sustainGesture = useDeviceParameterGesture({
        param: parameters.find((param) => param.id === 'sustain'),
        device,
        trackId,
    });
    const releaseGesture = useDeviceParameterGesture({
        param: parameters.find((param) => param.id === 'release'),
        device,
        trackId,
    });
    const envelopeGestures = {
        attack: attackGesture,
        decay: decayGesture,
        sustain: sustainGesture,
        release: releaseGesture,
    };
    const envelopePreviews = {
        attack: attackGesture.previewValue,
        decay: decayGesture.previewValue,
        sustain: sustainGesture.previewValue,
        release: releaseGesture.previewValue,
    };
    const changeEnvelope = (stage: string, value: number): void => {
        if (stage === 'attack' || stage === 'decay' || stage === 'sustain' || stage === 'release') {
            envelopeGestures[stage].change(value, true);
        }
    };

    return (
        <div>
            <SectionHeader title="Envelope" />
            <Row align="stretch" justify="center" className="mb-3">
                <ADSREnvelope
                    attack={attackGesture.value ?? 0.01}
                    decay={decayGesture.value ?? 0.2}
                    sustain={sustainGesture.value ?? 0.7}
                    release={releaseGesture.value ?? 0.3}
                    width={200}
                    height={80}
                    onParamChange={changeEnvelope}
                    onGestureStart={(stage) =>
                        envelopeGestures[stage].isGestureCurrent(envelopeGestures[stage].startGesture())
                    }
                    onGestureCommit={(stage) => envelopeGestures[stage].settleGesture()}
                    onGestureCancel={(stage) => envelopeGestures[stage].cancel()}
                />
            </Row>
            <Row2
                ids={['attack', 'decay']}
                params={parameters}
                device={device}
                trackId={trackId}
                previewValues={envelopePreviews}
            />
            <div className="mt-2">
                <Row2
                    ids={['sustain', 'release']}
                    params={parameters}
                    device={device}
                    trackId={trackId}
                    previewValues={envelopePreviews}
                />
            </div>
        </div>
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
                <Row align="stretch" justify="center" className="mb-3">
                    <OscillatorWaveform
                        waveform={waveform}
                        osc2Waveform={osc2Waveform}
                        osc2Mix={pv.osc2Mix ?? 0}
                        detune={pv.osc2Detune ?? 0}
                        width={200}
                        height={60}
                    />
                </Row>
                <Row2 ids={['waveform', 'detune']} params={parameters} device={device} trackId={trackId} />
            </div>
            {/* Filter — interactive */}
            <div>
                <SectionHeader title="Filter" />
                <Row align="stretch" justify="center" className="mb-3">
                    <FilterResponse
                        cutoff={pv.filterCutoff ?? 5000}
                        resonance={pv.filterResonance ?? 1}
                        filterType={pv.filterType ?? 0}
                        width={200}
                        height={70}
                        onParamChange={change}
                    />
                </Row>
                <Row2 ids={['filterCutoff', 'filterResonance']} params={parameters} device={device} trackId={trackId} />
            </div>
            {/* Envelope — interactive */}
            <SynthEnvelopeSection device={device} trackId={trackId} parameters={parameters} />
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
