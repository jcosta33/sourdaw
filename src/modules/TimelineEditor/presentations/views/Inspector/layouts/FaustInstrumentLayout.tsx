/**
 * Faust Instrument — Dedicated layout with identity header,
 * semantic parameter grouping, and collapsible advanced sections.
 */
import { type ReactElement } from 'react';

import { ADSREnvelope } from '#/components/daw/visualizers/ADSREnvelope';
import { CompressorCurve } from '#/components/daw/visualizers/CompressorCurve';
import { FilterResponse } from '#/components/daw/visualizers/FilterResponse';
import { OscillatorWaveform } from '#/components/daw/visualizers/OscillatorWaveform';
import { Row, Stack } from '#/components/layout';
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
    const dt = (device.type ?? '').toLowerCase();

    // Primary detection: device type / ID patterns (stable, no guessing)
    const isCompressor = dt.includes('compressor') || dt.includes('1176');
    const isEq = dt.includes('eq') || dt.includes('parametric');
    const isSynth = dt.includes('synth') || dt.includes('instrument');

    // Visualization flags derived from device type
    const hasCompressor = isCompressor;
    const hasFilter =
        isEq ||
        parameters.some((param) => param.id === 'cutoff' || param.id === 'frequency' || param.id.includes('freq'));
    const hasEnvelope =
        isSynth ||
        parameters.some((param) => param.id === 'attack' && parameters.some((query) => query.id === 'sustain'));
    const hasOscillator =
        isSynth && parameters.some((param) => param.id === 'waveform' || param.id === 'wave' || param.id === 'morph');

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
                            attack={pv.attack ?? pv.Attack ?? 0.01}
                            decay={pv.decay ?? pv.Decay ?? 0.2}
                            sustain={pv.sustain ?? pv.Sustain ?? 0.7}
                            release={pv.release ?? pv.Release ?? 0.3}
                            width={200}
                            height={70}
                            onParamChange={change}
                        />
                    </Row>
                </div>
            ) : null}
            {hasFilter ? (
                <div>
                    <SectionHeader title="Filter" />
                    <Row align="stretch" justify="center" className="mb-2">
                        <FilterResponse
                            cutoff={pv.cutoff ?? pv.Cutoff ?? pv.frequency ?? 5000}
                            resonance={pv.resonance ?? pv.Resonance ?? pv.q ?? 1}
                            filterType={0}
                            width={200}
                            height={60}
                            onParamChange={change}
                        />
                    </Row>
                </div>
            ) : null}
            {hasCompressor ? (
                <div>
                    <SectionHeader title="Compression" />
                    <Row align="stretch" justify="center" className="mb-2">
                        <CompressorCurve
                            threshold={pv.threshold ?? pv.Threshold ?? -20}
                            ratio={pv.ratio ?? pv.Ratio ?? 4}
                            knee={pv.knee ?? pv.Knee ?? 6}
                            makeup={pv.makeup ?? pv.Makeup ?? 0}
                            width={200}
                            height={120}
                            onParamChange={change}
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
                        <div className="grid grid-cols-2 gap-2 mt-1">
                            {params.map((param) => (
                                <Param key={param.id} param={param} device={device} trackId={trackId} />
                            ))}
                        </div>
                    </div>
                );
            })}
        </Stack>
    );
};

registerPrefixLayout('faust-', FaustInstrumentLayout);
