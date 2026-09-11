/**
 * Faust Instrument — Dedicated layout with identity header,
 * semantic parameter grouping, and collapsible advanced sections.
 */
import { type ReactElement } from 'react';

import { ADSREnvelope } from '#/components/daw/visualizers/ADSREnvelope';
import { CompressorCurve } from '#/components/daw/visualizers/CompressorCurve';
import { FilterResponse } from '#/components/daw/visualizers/FilterResponse';
import { OscillatorWaveform } from '#/components/daw/visualizers/OscillatorWaveform';
import { Grid, Row, Stack } from '#/components/layout';
import { setDeviceParameter } from '#/modules/Arrangement/useCases';

import { SurfaceCard } from '../../../components/Inspector/SurfaceCard';
import { type DeviceLayoutProps, registerPrefixLayout } from '../deviceLayoutRegistry';
import { DeviceParameterControl } from '../DeviceParameterControl';
import { SectionHeader } from '../SectionHeader';

type P = DeviceLayoutProps['parameters'][number];

// ── Categorization ──
type ParamCategory = { title: string; match: (name: string) => boolean; primary: boolean };

const CATEGORIES: ParamCategory[] = [
    {
        title: 'Tone',
        match: (node) => /bright|tone|cutoff|frequency|color|filter|harmonic|timbre/i.test(node),
        primary: true,
    },
    { title: 'Envelope', match: (node) => /attack|decay|sustain|release|adsr|env/i.test(node), primary: true },
    { title: 'Output', match: (node) => /gain|volume|level|mix|output|master/i.test(node), primary: true },
    {
        title: 'Modulation',
        match: (node) => /mod|vibrato|tremolo|lfo|rate|depth|chorus|leslie|speed/i.test(node),
        primary: false,
    },
    { title: 'Resonance', match: (node) => /damp|reson|feedback|decay|ring|reverb/i.test(node), primary: false },
    { title: 'Drawbars', match: (node) => /drawbar/i.test(node), primary: true },
    { title: 'Character', match: (node) => /percussion|click|drive|saturation|overdrive/i.test(node), primary: false },
];

function categorizeParams(params: P[]): { title: string; params: P[]; primary: boolean }[] {
    const result: { title: string; params: P[]; primary: boolean }[] = [];
    const used = new Set<string>();

    for (const cat of CATEGORIES) {
        const matching = params.filter((param) => cat.match(param.name) && !used.has(param.id));
        if (matching.length > 0) {
            result.push({ title: cat.title, params: matching, primary: cat.primary });
            for (const param of matching) {
                used.add(param.id);
            }
        }
    }

    const remaining = params.filter((param) => !used.has(param.id));
    if (remaining.length > 0) {
        result.push({ title: 'Other', params: remaining, primary: false });
    }

    return result;
}

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

const FaustInstrumentLayout = ({ device, trackId, parameters }: DeviceLayoutProps): ReactElement => {
    const categories = categorizeParams(parameters);

    const change = (id: string, value: number): void => {
        setDeviceParameter(device.id, id, value);
    };

    // Detect visualizations from device type (stable) with parameter fallback
    const pv = device.parameterValues;

    // 1. Envelope (generic ADSR requires declared attack, decay, sustain, release)
    const attackParam = parameters.find((p) => p.id === 'attack' || p.id === 'Attack');
    const decayParam = parameters.find((p) => p.id === 'decay' || p.id === 'Decay');
    const sustainParam = parameters.find((p) => p.id === 'sustain' || p.id === 'Sustain');
    const releaseParam = parameters.find((p) => p.id === 'release' || p.id === 'Release');
    const hasEnvelope = Boolean(attackParam && decayParam && sustainParam && releaseParam);

    // 2. Filter (requires declared filter cutoff parameter; do NOT match MIDI freq / frequency)
    const cutoffParam = parameters.find(
        (p) => p.id === 'cutoff' || p.id === 'filterCutoff' || p.id === 'filter_cutoff'
    );
    const resonanceParam = parameters.find(
        (p) => p.id === 'resonance' || p.id === 'filterResonance' || p.id === 'filter_resonance' || p.id === 'q'
    );
    const hasFilter = Boolean(cutoffParam);

    // 3. Compressor (requires declared threshold and ratio)
    const thresholdParam = parameters.find(
        (p) => p.id === 'threshold' || p.id === 'comp-threshold' || p.id === 'Threshold'
    );
    const ratioParam = parameters.find((p) => p.id === 'ratio' || p.id === 'comp-ratio' || p.id === 'Ratio');
    const kneeParam = parameters.find((p) => p.id === 'knee' || p.id === 'comp-knee' || p.id === 'Knee');
    const makeupParam = parameters.find((p) => p.id === 'makeup' || p.id === 'comp-makeup' || p.id === 'Makeup');
    const hasCompressor = Boolean(thresholdParam && ratioParam);

    // 4. Oscillator
    const dt = (device.type ?? '').toLowerCase();
    const isSynth = dt.includes('synth') || dt.includes('instrument');
    const hasOscillator =
        isSynth && parameters.some((param) => param.id === 'waveform' || param.id === 'wave' || param.id === 'morph');

    const handleFilterChange = (id: string, value: number): void => {
        if ((id === 'filterCutoff' || id === 'cutoff') && cutoffParam) {
            change(cutoffParam.id, value);
        } else if ((id === 'filterResonance' || id === 'resonance') && resonanceParam) {
            change(resonanceParam.id, value);
        }
    };

    const handleEnvelopeChange = (stage: string, value: number): void => {
        if (stage === 'attack' && attackParam) {
            change(attackParam.id, value);
        } else if (stage === 'decay' && decayParam) {
            change(decayParam.id, value);
        } else if (stage === 'sustain' && sustainParam) {
            change(sustainParam.id, value);
        } else if (stage === 'release' && releaseParam) {
            change(releaseParam.id, value);
        }
    };

    const handleCompressorChange = (id: string, value: number): void => {
        if ((id === 'comp-threshold' || id === 'threshold') && thresholdParam) {
            change(thresholdParam.id, value);
        }
    };

    if (parameters.length === 0) {
        return (
            <div className="px-1">
                <p className="text-[10px] text-muted-foreground">
                    This instrument is loading. Parameters will appear shortly.
                </p>
            </div>
        );
    }

    return (
        <Stack gap={3}>
            {/* Interactive visualizations based on available parameters */}
            {hasEnvelope ? (
                <div>
                    <SectionHeader title="Envelope" />
                    <Row align="stretch" justify="center" className="mb-2">
                        <ADSREnvelope
                            attack={attackParam ? (pv[attackParam.id] ?? attackParam.defaultValue ?? 0.01) : 0.01}
                            decay={decayParam ? (pv[decayParam.id] ?? decayParam.defaultValue ?? 0.2) : 0.2}
                            sustain={sustainParam ? (pv[sustainParam.id] ?? sustainParam.defaultValue ?? 0.7) : 0.7}
                            release={releaseParam ? (pv[releaseParam.id] ?? releaseParam.defaultValue ?? 0.3) : 0.3}
                            width={200}
                            height={70}
                            onParamChange={handleEnvelopeChange}
                        />
                    </Row>
                </div>
            ) : null}
            {hasFilter ? (
                <div>
                    <SectionHeader title="Filter" />
                    <Row align="stretch" justify="center" className="mb-2">
                        <FilterResponse
                            cutoff={cutoffParam ? (pv[cutoffParam.id] ?? cutoffParam.defaultValue ?? 5000) : 5000}
                            resonance={resonanceParam ? (pv[resonanceParam.id] ?? resonanceParam.defaultValue ?? 1) : 1}
                            filterType={0}
                            width={200}
                            height={60}
                            onParamChange={handleFilterChange}
                        />
                    </Row>
                </div>
            ) : null}
            {hasCompressor ? (
                <div>
                    <SectionHeader title="Compression" />
                    <Row align="stretch" justify="center" className="mb-2">
                        <CompressorCurve
                            threshold={
                                thresholdParam ? (pv[thresholdParam.id] ?? thresholdParam.defaultValue ?? -20) : -20
                            }
                            ratio={ratioParam ? (pv[ratioParam.id] ?? ratioParam.defaultValue ?? 4) : 4}
                            knee={kneeParam ? (pv[kneeParam.id] ?? kneeParam.defaultValue ?? 6) : 6}
                            makeup={makeupParam ? (pv[makeupParam.id] ?? makeupParam.defaultValue ?? 0) : 0}
                            width={200}
                            height={120}
                            onParamChange={handleCompressorChange}
                        />
                    </Row>
                </div>
            ) : null}
            {hasOscillator ? (
                <div>
                    <SectionHeader title="Oscillator" />
                    <Row align="stretch" justify="center" className="mb-2">
                        <OscillatorWaveform
                            waveform="sawtooth"
                            osc2Waveform="sawtooth"
                            osc2Mix={pv.osc2_mix ?? pv.mix ?? 0}
                            detune={pv.detune ?? pv.Detune ?? 0}
                            width={200}
                            height={50}
                        />
                    </Row>
                </div>
            ) : null}
            {/* Parameter sections — all fully visible */}
            {categories.map(({ title, params }) => {
                return (
                    <div key={title} className="mb-4">
                        <SectionHeader title={title} />
                        <Grid cols={2} gap={2} className="mt-1">
                            {params.map((param) => (
                                <Param key={param.id} param={param} device={device} trackId={trackId} />
                            ))}
                        </Grid>
                    </div>
                );
            })}
        </Stack>
    );
};

registerPrefixLayout('faust-', FaustInstrumentLayout);
