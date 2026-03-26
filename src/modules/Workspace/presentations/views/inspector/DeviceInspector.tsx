import { type ReactElement } from 'react';
import { Card } from '#/components/ui/card';
import { Button } from '#/components/ui/button';
import {
    ChevronRight, Home, Landmark, Church, Disc3, Waves,
    Music, Mic, SlidersHorizontal, Warehouse, ArrowRightLeft,
} from 'lucide-react';
import { type LucideIcon } from 'lucide-react';
import { BUILTIN_PLUGINS } from '#/modules/Arrangement/useCases/trackQueries';
import { setDeviceParameter, bypassDevice } from '#/modules/Arrangement/useCases/device';
import { MechanicalSwitch } from '#/components/daw/MechanicalSwitch';
import { LatchButton } from '#/components/daw/LatchButton';
import { LED } from '#/components/daw/LED';
import { getSidechainSource, addSidechainRoute, removeSidechainRoute } from '#/modules/Routing/useCases/sidechain';
import { useTracks } from '../../hooks/useTracks';
import { type Device } from '#/modules/Arrangement/useCases/trackQueries';
import { DeviceParameterControl } from './DeviceParameterControl';
import { CompressorGainReduction } from '../metering/CompressorGainReduction';
import { CompressorCurve } from '../../components/CompressorCurve';
import { EQCurve } from '../../components/EQCurve';
import { ReverbDecay } from '../../components/ReverbDecay';
import { DelayTaps } from '../../components/DelayTaps';
import { DistortionCurve } from '../../components/DistortionCurve';
import { FilterResponse } from '../../components/FilterResponse';
import { ModulationLFO } from '../../components/ModulationLFO';
import { BitcrusherStaircase } from '../../components/BitcrusherStaircase';
import { LUFSMeter } from '../metering/LUFSMeter';
import { resolveDeviceLayout } from './deviceLayoutRegistry';
import './layouts';

type DeviceInspectorProps = {
    device: Device;
    trackId: string;
    onBack: () => void;
};

// ── IR type config for convolution reverb visual ──
type IRType = { label: string; icon: LucideIcon };

const IR_TYPES: IRType[] = [
    { label: 'Small Room', icon: Home },
    { label: 'Large Hall', icon: Landmark },
    { label: 'Cathedral', icon: Church },
    { label: 'Plate', icon: Disc3 },
    { label: 'Spring', icon: Waves },
    { label: 'Chamber', icon: Music },
    { label: 'Studio A', icon: Mic },
    { label: 'Studio B', icon: SlidersHorizontal },
    { label: 'Warehouse', icon: Warehouse },
    { label: 'Tunnel', icon: ArrowRightLeft },
];

// ── Section headers ──
const SectionHeader = ({ title }: { title: string }): ReactElement => (
    <div className="px-1 mb-2 border-b border-border-hairline pb-1">
        <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
            {title}
        </div>
    </div>
);



// ── Param grid helper ──
type DeviceParam = (typeof BUILTIN_PLUGINS)[number]['parameters'][number];

const ParamGrid = ({ params, device, trackId, cols = 2 }: {
    params: DeviceParam[];
    device: Device;
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

// ── Param filter helper ──
const filterParams = (params: DeviceParam[], ids: string[]): DeviceParam[] =>
    params.filter((p) => ids.includes(p.id));

export const DeviceInspector = ({ device, trackId, onBack }: DeviceInspectorProps): ReactElement => {
    const { tracks: allTracks } = useTracks();
    const plugin = BUILTIN_PLUGINS.find(
        (p) =>
            p.id === device.type ||
            p.id === `builtin-${device.type}` ||
            p.name.toLowerCase() === device.type?.toLowerCase() ||
            p.name === device.name
    );
    const parameters = plugin?.parameters ?? [];
    const isLimiter = plugin?.id === 'builtin-limiter';
    const isSidechainComp =
        device.type?.toLowerCase().includes('sidechain') ?? device.name?.toLowerCase().includes('sidechain');
    const isCompressorLimiter = (plugin?.id === 'builtin-compressor' || isSidechainComp) && !isLimiter;
    const isConvolutionReverb = plugin?.id === 'builtin-convolution-reverb';
    const isReverb = plugin?.id === 'builtin-reverb';
    const isDelay = plugin?.id === 'builtin-delay';
    const isEQ = plugin?.id === 'builtin-eq';
    const isDistortion = plugin?.id === 'builtin-distortion';
    const isFilter = plugin?.id === 'builtin-filter';
    const isChorus = plugin?.id === 'builtin-chorus';
    const isFlanger = plugin?.id === 'builtin-flanger';
    const isPhaser = plugin?.id === 'builtin-phaser';
    const isTremolo = plugin?.id === 'builtin-tremolo';
    const isAutoPan = plugin?.id === 'builtin-autopan';
    const isBitcrusher = plugin?.id === 'builtin-bitcrusher';
    const isGain = plugin?.id === 'builtin-gain';
    const isStereoWidener = plugin?.id === 'builtin-stereo-widener';
    const isDeEsser = plugin?.id === 'builtin-deesser';
    const isLufsMeter = plugin?.id === 'builtin-lufs-meter';

    const sidechainSource = getSidechainSource(device.id);
    const sourceTracks = allTracks.filter((t) => t.kind !== 'master' && t.kind !== 'folder' && t.id !== trackId);

    const pv = device.parameterValues;

    // ── Modulation helpers for Chorus/Flanger/Phaser/Tremolo/AutoPan ──
    const getLfoShape = (): 'sine' | 'triangle' | 'square' => {
        if (isTremolo) return (pv['trem-shape'] ?? 0) === 1 ? 'square' : 'sine';
        if (isAutoPan) return (pv['autopan-shape'] ?? 0) === 1 ? 'triangle' : 'sine';
        return 'sine';
    };

    const getLfoRate = (): number => {
        if (isChorus) return pv['chorus-rate'] ?? 1;
        if (isFlanger) return pv['flanger-rate'] ?? 0.3;
        if (isPhaser) return pv['phaser-rate'] ?? 0.5;
        if (isTremolo) return pv['trem-rate'] ?? 4;
        if (isAutoPan) return pv['autopan-rate'] ?? 2;
        return 1;
    };

    const getLfoDepth = (): number => {
        if (isChorus) return pv['chorus-depth'] ?? 5;
        if (isFlanger) return Math.min(1, (pv['flanger-depth'] ?? 3) / 10);
        if (isPhaser) return (pv['phaser-depth'] ?? 0.5);
        if (isTremolo) return pv['trem-depth'] ?? 0.5;
        if (isAutoPan) return pv['autopan-depth'] ?? 0.7;
        return 0.5;
    };

    const isModulation = isChorus || isFlanger || isPhaser || isTremolo || isAutoPan;

    return (
        <div className="space-y-4 p-3">
            <div className="flex flex-row items-center justify-between mb-4">
                <div className="flex items-center gap-1">
                    <Button variant="ghost" size="icon-xs" onClick={onBack} aria-label="Back to track">
                        <ChevronRight className="size-3 rotate-180" />
                    </Button>
                    <h3 className="text-xs font-medium text-foreground">{device.name}</h3>
                </div>
                <MechanicalSwitch checked={!device.bypassed} onChange={(c) => bypassDevice(device.id, !c)} size="sm" />
            </div>

            {/* ── Registry-based layout (scalable) ── */}
            {(() => {
                const LayoutComponent = resolveDeviceLayout(device.type ?? '');
                if (LayoutComponent) {
                    return <LayoutComponent device={device} trackId={trackId} parameters={parameters} />;
                }
                return null;
            })()}

            {/* ── Legacy layouts (effects — to be migrated to registry over time) ── */}
            {!resolveDeviceLayout(device.type ?? '') && (
            <>

            {/* ── Sidechain Source Selector ── */}
            {isSidechainComp ? (
                <div>
                    <SectionHeader title="Sidechain Source" />
                    <div className="grid grid-cols-1 @md:grid-cols-2 gap-2">
                        <Card className="rounded-md shadow-none bg-surface-base border-border/50 p-2">
                            <select
                                className="w-full rounded border border-border bg-surface-overlay px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                                value={sidechainSource?.sourceTrackId ?? ''}
                                onChange={(e) => {
                                    const srcId = e.target.value;
                                    if (srcId) {
                                        addSidechainRoute(srcId, trackId, device.id);
                                    } else if (sidechainSource) {
                                        removeSidechainRoute(sidechainSource.id);
                                    }
                                }}
                            >
                                <option value="">None</option>
                                {sourceTracks.map((t) => (
                                    <option key={t.id} value={t.id}>
                                        {t.name}
                                    </option>
                                ))}
                            </select>
                        </Card>
                    </div>
                </div>
            ) : null}

            {/* ── Compressor/Limiter: Curve + Gain Reduction ── */}
            {isCompressorLimiter ? (
                <div className="space-y-3">
                    <div>
                        <SectionHeader title="Transfer Curve" />
                        <div className="flex justify-center">
                            <CompressorCurve
                                threshold={pv['comp-threshold'] ?? pv['lim-threshold'] ?? -20}
                                ratio={isLimiter ? 20 : (pv['comp-ratio'] ?? 4)}
                                knee={pv['comp-knee'] ?? 6}
                                makeup={pv['comp-makeup'] ?? 0}
                                width={180}
                                height={120}
                            />
                        </div>
                    </div>
                    {!isLimiter && (
                        <div>
                            <SectionHeader title="Gain Reduction" />
                            <div className="flex justify-center">
                                <CompressorGainReduction
                                    trackId={trackId}
                                    threshold={pv['comp-threshold'] ?? -12}
                                    ratio={pv['comp-ratio'] ?? 4}
                                />
                            </div>
                        </div>
                    )}
                </div>
            ) : null}

            {/* ── Convolution Reverb: Specialized Layout ── */}
            {isConvolutionReverb && parameters.length > 0 ? (
                <div className="space-y-3">
                    <div>
                        <SectionHeader title="Impulse Response" />
                        <div className="grid grid-cols-2 gap-1">
                            {IR_TYPES.map(({ label, icon: Icon }, i) => {
                                const isActive = Math.round(pv['conv-ir'] ?? 6) === i;
                                return (
                                    <LatchButton
                                        key={label}
                                        active={isActive}
                                        variant="cyan"
                                        size="xs"
                                        className="w-full justify-start gap-1.5"
                                        onClick={() => setDeviceParameter(device.id, 'conv-ir', i)}
                                        aria-pressed={isActive}
                                        title={label}
                                    >
                                        <LED on={isActive} variant="cyan" size="sm" />
                                        <Icon className="size-3 shrink-0" aria-hidden="true" />
                                        <span className="truncate text-[10px]">{label}</span>
                                    </LatchButton>
                                );
                            })}
                        </div>
                    </div>
                    <div>
                        <SectionHeader title="Mix" />
                        <ParamGrid params={filterParams(parameters, ['conv-mix', 'conv-predelay'])} device={device} trackId={trackId} />
                    </div>
                    <div>
                        <SectionHeader title="Tone" />
                        <ParamGrid params={filterParams(parameters, ['conv-lowcut', 'conv-highcut'])} device={device} trackId={trackId} />
                    </div>
                </div>

            /* ── EQ: 3-Band Grouped Layout ── */
            ) : isEQ && parameters.length > 0 ? (
                <div className="space-y-3">
                    <div>
                        <SectionHeader title="Frequency Response" />
                        <div className="flex justify-center">
                            <EQCurve
                                lowGain={pv['eq-low-gain'] ?? 0}
                                lowFreq={pv['eq-low-freq'] ?? 100}
                                lowQ={pv['eq-low-q'] ?? 1}
                                midGain={pv['eq-mid-gain'] ?? 0}
                                midFreq={pv['eq-mid-freq'] ?? 1000}
                                midQ={pv['eq-mid-q'] ?? 1}
                                highGain={pv['eq-high-gain'] ?? 0}
                                highFreq={pv['eq-high-freq'] ?? 8000}
                                highQ={pv['eq-high-q'] ?? 1}
                            />
                        </div>
                    </div>
                    <div>
                        <SectionHeader title="EQ Graphic" />
                        <div className="grid grid-cols-1 @md:grid-cols-3 gap-2">
                            {(['Low', 'Mid', 'High'] as const).map((band) => (
                                <Card key={band} className="rounded-md shadow-none bg-surface-base border-border/50 p-2 flex flex-col items-center gap-1">
                                    <span className="text-[9px] text-muted-foreground font-semibold uppercase mb-2">{band}</span>
                                    <div className="w-full space-y-4">
                                        {parameters
                                            .filter((p) => p.name.includes(band))
                                            .map((param) => (
                                                <DeviceParameterControl key={param.id} param={param} device={device} trackId={trackId} />
                                            ))}
                                    </div>
                                </Card>
                            ))}
                        </div>
                    </div>
                </div>

            /* ── Reverb: Space / Color / Mix layout ── */
            ) : isReverb && parameters.length > 0 ? (
                <div className="space-y-3">
                    <div>
                        <SectionHeader title="Decay Envelope" />
                        <div className="flex justify-center">
                            <ReverbDecay
                                size={pv['rev-size'] ?? 0.5}
                                decay={pv['rev-decay'] ?? 2}
                                damping={pv['rev-damping'] ?? 0.5}
                                predelay={pv['rev-predelay'] ?? 10}
                            />
                        </div>
                    </div>
                    <div>
                        <SectionHeader title="Space" />
                        <ParamGrid params={filterParams(parameters, ['rev-size', 'rev-decay', 'rev-predelay'])} device={device} trackId={trackId} />
                    </div>
                    <div>
                        <SectionHeader title="Color" />
                        <ParamGrid params={filterParams(parameters, ['rev-damping', 'rev-lowcut', 'rev-mix'])} device={device} trackId={trackId} />
                    </div>
                </div>

            /* ── Delay: Time / Feedback / Mix layout ── */
            ) : isDelay && parameters.length > 0 ? (
                <div className="space-y-3">
                    <div>
                        <SectionHeader title="Tap Pattern" />
                        <div className="flex justify-center">
                            <DelayTaps
                                time={pv['delay-time'] ?? 250}
                                feedback={pv['delay-feedback'] ?? 0.4}
                                mix={pv['delay-mix'] ?? 0.3}
                            />
                        </div>
                    </div>
                    <div>
                        <SectionHeader title="Timing" />
                        <ParamGrid params={filterParams(parameters, ['delay-time', 'delay-mix'])} device={device} trackId={trackId} />
                    </div>
                    <div>
                        <SectionHeader title="Character" />
                        <ParamGrid params={filterParams(parameters, ['delay-feedback', 'delay-lowcut', 'delay-highcut'])} device={device} trackId={trackId} />
                    </div>
                </div>

            /* ── Distortion: Transfer Curve + Drive/Tone/Output ── */
            ) : isDistortion && parameters.length > 0 ? (
                <div className="space-y-3">
                    <div>
                        <SectionHeader title="Transfer Curve" />
                        <div className="flex justify-center">
                            <DistortionCurve
                                drive={pv['dist-drive'] ?? 20}
                                tone={pv['dist-tone'] ?? 4000}
                                mix={pv['dist-mix'] ?? 0.5}
                                width={180}
                                height={120}
                            />
                        </div>
                    </div>
                    <div>
                        <SectionHeader title="Drive" />
                        <ParamGrid params={filterParams(parameters, ['dist-drive', 'dist-tone'])} device={device} trackId={trackId} />
                    </div>
                    <div>
                        <SectionHeader title="Output" />
                        <ParamGrid params={filterParams(parameters, ['dist-output', 'dist-mix'])} device={device} trackId={trackId} />
                    </div>
                </div>

            /* ── Filter: Frequency Response + Cutoff/Res/Type ── */
            ) : isFilter && parameters.length > 0 ? (
                <div className="space-y-3">
                    <div>
                        <SectionHeader title="Frequency Response" />
                        <div className="flex justify-center">
                            <FilterResponse
                                cutoff={pv['filter-cutoff'] ?? 1000}
                                resonance={pv['filter-resonance'] ?? 1}
                                filterType={pv['filter-type'] ?? 0}
                                width={180}
                                height={80}
                            />
                        </div>
                    </div>
                    <div>
                        <SectionHeader title="Filter" />
                        <ParamGrid params={filterParams(parameters, ['filter-type'])} device={device} trackId={trackId} cols={1} />
                    </div>
                    <div>
                        <SectionHeader title="Shape" />
                        <ParamGrid params={filterParams(parameters, ['filter-cutoff', 'filter-resonance'])} device={device} trackId={trackId} />
                    </div>
                </div>

            /* ── Modulation effects: Chorus, Flanger, Phaser, Tremolo, Auto-Pan ── */
            ) : isModulation && parameters.length > 0 ? (
                <div className="space-y-3">
                    <div>
                        <SectionHeader title="LFO Waveform" />
                        <div className="flex justify-center">
                            <ModulationLFO
                                rate={getLfoRate()}
                                depth={getLfoDepth()}
                                shape={getLfoShape()}
                                width={180}
                                height={60}
                            />
                        </div>
                    </div>
                    <div>
                        <SectionHeader title="Modulation" />
                        <ParamGrid params={parameters.filter((p) =>
                            p.name.toLowerCase().includes('rate') ||
                            p.name.toLowerCase().includes('depth') ||
                            p.name.toLowerCase().includes('shape')
                        )} device={device} trackId={trackId} />
                    </div>
                    {parameters.some((p) =>
                        p.name.toLowerCase().includes('feedback') ||
                        p.name.toLowerCase().includes('mix') ||
                        p.name.toLowerCase().includes('dry') ||
                        p.name.toLowerCase().includes('stages') ||
                        p.name.toLowerCase().includes('voices')
                    ) && (
                        <div>
                            <SectionHeader title="Character" />
                            <ParamGrid params={parameters.filter((p) =>
                                p.name.toLowerCase().includes('feedback') ||
                                p.name.toLowerCase().includes('mix') ||
                                p.name.toLowerCase().includes('dry') ||
                                p.name.toLowerCase().includes('stages') ||
                                p.name.toLowerCase().includes('voices')
                            )} device={device} trackId={trackId} />
                        </div>
                    )}
                </div>

            /* ── Bitcrusher: Staircase + Controls ── */
            ) : isBitcrusher && parameters.length > 0 ? (
                <div className="space-y-3">
                    <div>
                        <SectionHeader title="Quantization" />
                        <div className="flex justify-center">
                            <BitcrusherStaircase
                                bits={pv['crush-bits'] ?? 8}
                                rateReduction={pv['crush-rate'] ?? 1}
                                mix={pv['crush-mix'] ?? 0.5}
                                width={180}
                                height={80}
                            />
                        </div>
                    </div>
                    <div>
                        <SectionHeader title="Crush" />
                        <ParamGrid params={filterParams(parameters, ['crush-bits', 'crush-rate'])} device={device} trackId={trackId} />
                    </div>
                    <div>
                        <SectionHeader title="Mix" />
                        <ParamGrid params={filterParams(parameters, ['crush-mix'])} device={device} trackId={trackId} cols={1} />
                    </div>
                </div>

            /* ── Stereo Widener ── */
            ) : isStereoWidener && parameters.length > 0 ? (
                <div className="space-y-3">
                    <div>
                        <SectionHeader title="Stereo Image" />
                        <div className="flex justify-center">
                            <div className="relative w-[180px] h-[60px] rounded border border-border/30 bg-[var(--color-bg-tray)] overflow-hidden">
                                {/* Visual stereo width indicator */}
                                <div
                                    className="absolute top-0 h-full bg-[var(--color-accent-teal)]/10 transition-all duration-200"
                                    style={{
                                        left: `${50 - Math.min(50, ((pv['width-amount'] ?? 1) / 3) * 50)}%`,
                                        width: `${Math.min(100, ((pv['width-amount'] ?? 1) / 3) * 100)}%`,
                                    }}
                                />
                                <div className="absolute inset-0 flex items-center justify-center">
                                    <div className="h-full w-px bg-[var(--color-accent-teal)]/30" />
                                </div>
                                <div className="absolute bottom-1 left-1 text-[7px] text-muted-foreground font-mono">L</div>
                                <div className="absolute bottom-1 right-1 text-[7px] text-muted-foreground font-mono">R</div>
                                <div className="absolute top-1 left-1/2 -translate-x-1/2 text-[8px] font-mono text-[var(--color-accent-teal)]">
                                    {((pv['width-amount'] ?? 1) * 100).toFixed(0)}%
                                </div>
                            </div>
                        </div>
                    </div>
                    <div>
                        <SectionHeader title="Width" />
                        <ParamGrid params={filterParams(parameters, ['width-amount'])} device={device} trackId={trackId} cols={1} />
                    </div>
                    <div>
                        <SectionHeader title="Mid/Side Balance" />
                        <ParamGrid params={filterParams(parameters, ['width-mid', 'width-side'])} device={device} trackId={trackId} />
                    </div>
                    <div>
                        <SectionHeader title="Bass Control" />
                        <ParamGrid params={filterParams(parameters, ['width-mono-bass'])} device={device} trackId={trackId} cols={1} />
                    </div>
                </div>

            /* ── De-esser ── */
            ) : isDeEsser && parameters.length > 0 ? (
                <div className="space-y-3">
                    <div>
                        <SectionHeader title="Sibilance Band" />
                        <div className="flex justify-center">
                            <FilterResponse
                                cutoff={pv['deess-freq'] ?? 6000}
                                resonance={4}
                                filterType={2}
                                width={180}
                                height={60}
                            />
                        </div>
                    </div>
                    <div>
                        <SectionHeader title="Detection" />
                        <ParamGrid params={filterParams(parameters, ['deess-threshold', 'deess-freq'])} device={device} trackId={trackId} />
                    </div>
                    <div>
                        <SectionHeader title="Reduction" />
                        <ParamGrid params={filterParams(parameters, ['deess-range', 'deess-listen'])} device={device} trackId={trackId} />
                    </div>
                </div>

            /* ── LUFS Meter ── */
            ) : isLufsMeter ? (
                <div className="space-y-3">
                    <div>
                        <SectionHeader title="Loudness" />
                        <div className="flex justify-center">
                            <LUFSMeter
                                target={pv['lufs-target'] ?? -14}
                                width={48}
                                height={160}
                            />
                        </div>
                    </div>
                    <div>
                        <SectionHeader title="Settings" />
                        <ParamGrid params={parameters} device={device} trackId={trackId} />
                    </div>
                </div>

            /* ── Limiter (standalone) ── */
            ) : isLimiter && parameters.length > 0 ? (
                <div className="space-y-3">
                    <div>
                        <SectionHeader title="Transfer Curve" />
                        <div className="flex justify-center">
                            <CompressorCurve
                                threshold={pv['lim-threshold'] ?? -6}
                                ratio={20}
                                knee={1}
                                makeup={0}
                                width={180}
                                height={120}
                            />
                        </div>
                    </div>
                    <div>
                        <SectionHeader title="Limiter" />
                        <ParamGrid params={parameters} device={device} trackId={trackId} />
                    </div>
                </div>

            /* ── Gain/Utility ── */
            ) : isGain && parameters.length > 0 ? (
                <div className="space-y-3">
                    <div>
                        <SectionHeader title="Utility" />
                        <ParamGrid params={parameters} device={device} trackId={trackId} cols={1} />
                    </div>
                </div>

            /* ── Generic fallback: 2-column parameter grid ── */
            ) : parameters.length > 0 ? (
                <div>
                    <SectionHeader title="Parameters" />
                    <ParamGrid params={parameters} device={device} trackId={trackId} />
                </div>
            ) : (
                <div className="px-1">
                    <p className="text-[10px] text-muted-foreground">No parameters available for this device.</p>
                </div>
            )}
            </>
            )}
        </div>
    );
};
