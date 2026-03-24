import { type WAMDescriptor } from '#/modules/Plugin/models/WamPluginHostTypes';
import { registerWAMPlugin } from './hostOperations';

const BUILTIN_WAM_DESCRIPTORS: WAMDescriptor[] = [
    { id: 'webdaw.eq', name: 'Parametric EQ', vendor: 'WebDAW', version: '1.0', category: 'effect', sdkVersion: '2.0', keywords: ['eq', 'filter', 'tone'] },
    { id: 'webdaw.compressor', name: 'Compressor', vendor: 'WebDAW', version: '1.0', category: 'effect', sdkVersion: '2.0', keywords: ['dynamics', 'compressor'] },
    { id: 'webdaw.reverb', name: 'Reverb', vendor: 'WebDAW', version: '1.0', category: 'effect', sdkVersion: '2.0', keywords: ['reverb', 'space'] },
    { id: 'webdaw.delay', name: 'Delay', vendor: 'WebDAW', version: '1.0', category: 'effect', sdkVersion: '2.0', keywords: ['delay', 'echo'] },
    { id: 'webdaw.chorus', name: 'Chorus', vendor: 'WebDAW', version: '1.0', category: 'effect', sdkVersion: '2.0', keywords: ['modulation', 'chorus'] },
    { id: 'webdaw.distortion', name: 'Distortion', vendor: 'WebDAW', version: '1.0', category: 'effect', sdkVersion: '2.0', keywords: ['distortion', 'saturation'] },
    { id: 'webdaw.limiter', name: 'Limiter', vendor: 'WebDAW', version: '1.0', category: 'effect', sdkVersion: '2.0', keywords: ['dynamics', 'limiter'] },
    { id: 'webdaw.synth', name: 'Subtractive Synth', vendor: 'WebDAW', version: '1.0', category: 'instrument', sdkVersion: '2.0', keywords: ['synth', 'subtractive'] },
    { id: 'webdaw.drumkit', name: 'Drum Machine', vendor: 'WebDAW', version: '1.0', category: 'instrument', sdkVersion: '2.0', keywords: ['drums', 'percussion'] },
    { id: 'webdaw.sampler', name: 'Sampler', vendor: 'WebDAW', version: '1.0', category: 'instrument', sdkVersion: '2.0', keywords: ['sampler', 'sample'] },
    { id: 'webdaw.alchemy', name: 'Alchemy', vendor: 'WebDAW', version: '1.0', category: 'instrument', sdkVersion: '2.0', keywords: ['synth', 'additive', 'spectral', 'virtual analog'], isHighEnd: true },
    { id: 'webdaw.space-designer', name: 'Space Designer', vendor: 'WebDAW', version: '1.0', category: 'effect', sdkVersion: '2.0', keywords: ['reverb', 'convolution', 'impulse response'], isHighEnd: true },
    { id: 'webdaw.pro-eq', name: 'Pro EQ', vendor: 'WebDAW', version: '1.0', category: 'effect', sdkVersion: '2.0', keywords: ['eq', 'parametric', 'mastering'], isHighEnd: true },
];

export function registerBuiltinPlugins(): void {
    for (const desc of BUILTIN_WAM_DESCRIPTORS) {
        registerWAMPlugin(desc);
    }
}
