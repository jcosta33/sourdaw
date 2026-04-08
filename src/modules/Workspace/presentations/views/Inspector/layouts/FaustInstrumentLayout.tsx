/**
 * Faust Instrument — Dedicated layout with identity header,
 * semantic parameter grouping, and collapsible advanced sections.
 */
import { type ReactElement } from 'react';
import { type DeviceLayoutProps, SectionHeader, registerPrefixLayout } from '../deviceLayoutRegistry';
import { DeviceParameterControl } from '../DeviceParameterControl';
import { FilterResponse } from '#/components/daw/visualizers/FilterResponse';
import { ADSREnvelope } from '#/components/daw/visualizers/ADSREnvelope';
import { OscillatorWaveform } from '#/components/daw/visualizers/OscillatorWaveform';
import { CompressorCurve } from '#/components/daw/visualizers/CompressorCurve';
import { setDeviceParameter } from '#/modules/Arrangement/useCases/device/setDeviceParameter';
import { SurfaceCard } from '../../../components/Inspector/SurfaceCard';

type P = DeviceLayoutProps['parameters'][number];

// ── Categorization ──
type ParamCategory = { title: string; match: (name: string) => boolean; primary: boolean };

const CATEGORIES: ParamCategory[] = [
    {
        title: 'Tone',
        match: (n) => /bright|tone|cutoff|frequency|color|filter|harmonic|timbre/i.test(n),
        primary: true,
    },
    { title: 'Envelope', match: (n) => /attack|decay|sustain|release|adsr|env/i.test(n), primary: true },
    { title: 'Output', match: (n) => /gain|volume|level|mix|output|master/i.test(n), primary: true },
    {
        title: 'Modulation',
        match: (n) => /mod|vibrato|tremolo|lfo|rate|depth|chorus|leslie|speed/i.test(n),
        primary: false,
    },
    { title: 'Resonance', match: (n) => /damp|reson|feedback|decay|ring|reverb/i.test(n), primary: false },
    { title: 'Drawbars', match: (n) => /drawbar/i.test(n), primary: true },
    { title: 'Character', match: (n) => /percussion|click|drive|saturation|overdrive/i.test(n), primary: false },
];

function categorizeParams(params: P[]): { title: string; params: P[]; primary: boolean }[] {
    const result: { title: string; params: P[]; primary: boolean }[] = [];
    const used = new Set<string>();

    for (const cat of CATEGORIES) {
        const matching = params.filter((p) => cat.match(p.name) && !used.has(p.id));
        if (matching.length > 0) {
            result.push({ title: cat.title, params: matching, primary: cat.primary });
            for (const p of matching) {
                used.add(p.id);
            }
        }
    }

    const remaining = params.filter((p) => !used.has(p.id));
    if (remaining.length > 0) {
        result.push({ title: 'Other', params: remaining, primary: false });
    }

    return result;
}

const Param = ({
    p,
    device,
    trackId,
}: {
    p: P;
    device: DeviceLayoutProps['device'];
    trackId: string;
}): ReactElement => (
    <SurfaceCard className="rounded-md bg-surface-base p-2 w-full">
        <DeviceParameterControl param={p} device={device} trackId={trackId} />
    </SurfaceCard>
);

const FaustInstrumentLayout = ({ device, trackId, parameters }: DeviceLayoutProps): ReactElement => {
    const categories = categorizeParams(parameters);

    const change = (id: string, v: number): void => {
        setDeviceParameter(device.id, id, v);
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
        isEq || parameters.some((p) => p.id === 'cutoff' || p.id === 'frequency' || p.id.includes('freq'));
    const hasEnvelope =
        isSynth || parameters.some((p) => p.id === 'attack' && parameters.some((q) => q.id === 'sustain'));
    const hasOscillator = isSynth && parameters.some((p) => p.id === 'waveform' || p.id === 'wave' || p.id === 'morph');

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
        <div className="space-y-3">
            {/* Interactive visualizations based on available parameters */}
            {hasEnvelope ? (
                <div>
                    <SectionHeader title="Envelope" />
                    <div className="flex justify-center mb-2">
                        <ADSREnvelope
                            attack={pv['attack'] ?? pv['Attack'] ?? 0.01}
                            decay={pv['decay'] ?? pv['Decay'] ?? 0.2}
                            sustain={pv['sustain'] ?? pv['Sustain'] ?? 0.7}
                            release={pv['release'] ?? pv['Release'] ?? 0.3}
                            width={200}
                            height={70}
                            onParamChange={change}
                        />
                    </div>
                </div>
            ) : null}

            {hasFilter ? (
                <div>
                    <SectionHeader title="Filter" />
                    <div className="flex justify-center mb-2">
                        <FilterResponse
                            cutoff={pv['cutoff'] ?? pv['Cutoff'] ?? pv['frequency'] ?? 5000}
                            resonance={pv['resonance'] ?? pv['Resonance'] ?? pv['q'] ?? 1}
                            filterType={0}
                            width={200}
                            height={60}
                            onParamChange={change}
                        />
                    </div>
                </div>
            ) : null}

            {hasCompressor ? (
                <div>
                    <SectionHeader title="Compression" />
                    <div className="flex justify-center mb-2">
                        <CompressorCurve
                            threshold={pv['threshold'] ?? pv['Threshold'] ?? -20}
                            ratio={pv['ratio'] ?? pv['Ratio'] ?? 4}
                            knee={pv['knee'] ?? pv['Knee'] ?? 6}
                            makeup={pv['makeup'] ?? pv['Makeup'] ?? 0}
                            width={200}
                            height={120}
                            onParamChange={change}
                        />
                    </div>
                </div>
            ) : null}

            {hasOscillator ? (
                <div>
                    <SectionHeader title="Oscillator" />
                    <div className="flex justify-center mb-2">
                        <OscillatorWaveform
                            waveform="sawtooth"
                            osc2Waveform="sawtooth"
                            osc2Mix={pv['osc2_mix'] ?? pv['mix'] ?? 0}
                            detune={pv['detune'] ?? pv['Detune'] ?? 0}
                            width={200}
                            height={50}
                        />
                    </div>
                </div>
            ) : null}

            {/* Parameter sections — all fully visible */}
            {categories.map(({ title, params }) => {
                return (
                    <div key={title} className="mb-4">
                        <SectionHeader title={title} />
                        <div className="grid grid-cols-2 gap-2 mt-1">
                            {params.map((p) => (
                                <Param key={p.id} p={p} device={device} trackId={trackId} />
                            ))}
                        </div>
                    </div>
                );
            })}
        </div>
    );
};

registerPrefixLayout('faust-', FaustInstrumentLayout);
