import { type OfflineDeviceNode } from './deviceNodeFactory';
import { applyCompressorParams } from './devices/dynamics/applyCompressorParams';
import { applyEqParams } from './devices/dynamics/applyEqParams';
import { applyLimiterParams } from './devices/dynamics/applyLimiterParams';
import { applySidechainCompressorParams } from './devices/dynamics/applySidechainCompressorParams';
import { applyAutoPanParams } from './devices/modulation/applyAutoPanParams';
import { applyChorusParams } from './devices/modulation/applyChorusParams';
import { applyFlangerParams } from './devices/modulation/applyFlangerParams';
import { applyPhaserParams } from './devices/modulation/applyPhaserParams';
import { applyStereoWidenerParams } from './devices/modulation/applyStereoWidenerParams';
import { applyTremoloParams } from './devices/modulation/applyTremoloParams';
import { applyConvolutionReverbParams } from './devices/reverbDelay/applyConvolutionReverbParams';
import { applyDelayParams } from './devices/reverbDelay/applyDelayParams';
import { applyReverbParams } from './devices/reverbDelay/applyReverbParams';
import { applyBitcrusherParams } from './devices/toneShaping/applyBitcrusherParams';
import { applyDeEsserParams } from './devices/toneShaping/applyDeEsserParams';
import { applyDistortionParams } from './devices/toneShaping/applyDistortionParams';
import { applyFilterParams } from './devices/toneShaping/applyFilterParams';
import { applyGainParams } from './devices/toneShaping/applyGainParams';

const PARAM_APPLIERS: Record<string, (dn: OfflineDeviceNode, params: Record<string, number>) => void> = {
    'builtin-eq': applyEqParams,
    'builtin-compressor': applyCompressorParams,
    'builtin-sidechain-compressor': applySidechainCompressorParams,
    'builtin-limiter': applyLimiterParams,
    'builtin-reverb': applyReverbParams,
    'builtin-delay': applyDelayParams,
    'builtin-convolution-reverb': applyConvolutionReverbParams,
    'builtin-gain': applyGainParams,
    'builtin-filter': applyFilterParams,
    'builtin-distortion': applyDistortionParams,
    'builtin-bitcrusher': applyBitcrusherParams,
    'builtin-deesser': applyDeEsserParams,
    // builtin-lufs-meter intentionally omitted — pass-through analyser, no audio params
    'builtin-chorus': applyChorusParams,
    'builtin-phaser': applyPhaserParams,
    'builtin-flanger': applyFlangerParams,
    'builtin-tremolo': applyTremoloParams,
    'builtin-autopan': applyAutoPanParams,
    'builtin-stereo-widener': applyStereoWidenerParams,
};

export function applyParams(dn: OfflineDeviceNode, deviceType: string, params: Record<string, number>): void {
    PARAM_APPLIERS[deviceType]?.(dn, params);
}
