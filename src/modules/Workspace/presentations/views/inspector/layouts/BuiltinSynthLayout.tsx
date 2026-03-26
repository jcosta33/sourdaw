/**
 * Builtin Synth — Dedicated device inspector layout.
 *
 * Groups parameters into semantic sections with Canvas visualizations:
 * Oscillators → Filter → Envelope → Modulation → Output
 */
import { type ReactElement } from 'react';
import { Card } from '#/components/ui/card';
import {
    type DeviceLayoutProps,
    SectionHeader,
    filterParams,
    registerDeviceLayout,
} from '../deviceLayoutRegistry';
import { DeviceParameterControl } from '../DeviceParameterControl';
import { ADSREnvelope } from '../../../components/ADSREnvelope';
import { OscillatorWaveform } from '../../../components/OscillatorWaveform';
import { FilterResponse } from '../../../components/FilterResponse';

const WAVE_NAMES = ['sine', 'triangle', 'sawtooth', 'square'] as const;

type DeviceParam = DeviceLayoutProps['parameters'][number];

const ParamRow = ({ params, device, trackId, cols = 2 }: {
    params: DeviceParam[];
    device: DeviceLayoutProps['device'];
    trackId: string;
    cols?: number;
}): ReactElement => (
    <div className={`grid grid-cols-1 @md:grid-cols-${cols} gap-2`}>
        {params.map((param) => (
            <Card key={param.id} className="rounded-md shadow-none bg-surface-base border-border/50 p-3 w-full pb-4">
                <DeviceParameterControl param={param} device={device} trackId={trackId} />
            </Card>
        ))}
    </div>
);

const BuiltinSynthLayout = ({ device, trackId, parameters }: DeviceLayoutProps): ReactElement => {
    const pv = device.parameterValues;
    const wf1Idx = Math.round(pv['waveform'] ?? 2);
    const wf2Idx = Math.round(pv['osc2Waveform'] ?? 2);
    const waveform = WAVE_NAMES[wf1Idx] ?? 'sawtooth';
    const osc2Waveform = WAVE_NAMES[wf2Idx] ?? 'sawtooth';

    return (
        <div className="space-y-4">
            {/* ── Oscillators ── */}
            <div>
                <SectionHeader title="Oscillators" />
                <div className="flex justify-center mb-3">
                    <OscillatorWaveform
                        waveform={waveform}
                        osc2Waveform={osc2Waveform}
                        osc2Mix={pv['osc2Mix'] ?? 0}
                        detune={pv['osc2Detune'] ?? 0}
                        width={200}
                        height={60}
                    />
                </div>
                <ParamRow
                    params={filterParams(parameters, ['waveform', 'detune'])}
                    device={device}
                    trackId={trackId}
                />
                <div className="mt-2">
                    <ParamRow
                        params={filterParams(parameters, ['osc2Waveform', 'osc2Detune', 'osc2Mix'])}
                        device={device}
                        trackId={trackId}
                        cols={3}
                    />
                </div>
                <div className="mt-2">
                    <ParamRow
                        params={filterParams(parameters, ['subOscLevel', 'noiseLevel'])}
                        device={device}
                        trackId={trackId}
                    />
                </div>
            </div>

            {/* ── Filter ── */}
            <div>
                <SectionHeader title="Filter" />
                <div className="flex justify-center mb-3">
                    <FilterResponse
                        cutoff={pv['filterCutoff'] ?? 5000}
                        resonance={pv['filterResonance'] ?? 1}
                        filterType={pv['filterType'] ?? 0}
                        width={200}
                        height={70}
                    />
                </div>
                <ParamRow
                    params={filterParams(parameters, ['filterType'])}
                    device={device}
                    trackId={trackId}
                    cols={1}
                />
                <div className="mt-2">
                    <ParamRow
                        params={filterParams(parameters, ['filterCutoff', 'filterResonance', 'filterEnvAmount'])}
                        device={device}
                        trackId={trackId}
                        cols={3}
                    />
                </div>
            </div>

            {/* ── Envelope ── */}
            <div>
                <SectionHeader title="Envelope" />
                <div className="flex justify-center mb-3">
                    <ADSREnvelope
                        attack={pv['attack'] ?? 0.01}
                        decay={pv['decay'] ?? 0.2}
                        sustain={pv['sustain'] ?? 0.7}
                        release={pv['release'] ?? 0.3}
                        width={200}
                        height={80}
                    />
                </div>
                <ParamRow
                    params={filterParams(parameters, ['attack', 'decay', 'sustain', 'release'])}
                    device={device}
                    trackId={trackId}
                    cols={4}
                />
            </div>

            {/* ── Modulation ── */}
            <div>
                <SectionHeader title="Modulation" />
                <ParamRow
                    params={filterParams(parameters, ['vibratoRate', 'vibratoDepth'])}
                    device={device}
                    trackId={trackId}
                />
            </div>

            {/* ── Output ── */}
            <div>
                <SectionHeader title="Output" />
                <ParamRow
                    params={filterParams(parameters, ['gain', 'stereoSpread'])}
                    device={device}
                    trackId={trackId}
                />
            </div>
        </div>
    );
};

// ── Register for all builtin synth variants ──
registerDeviceLayout([
    'builtin-synth',
    'builtin-synth-mellotron',
    'builtin-synth-strings',
    'builtin-synth-808bass',
    'builtin-synth-brass',
], BuiltinSynthLayout);
