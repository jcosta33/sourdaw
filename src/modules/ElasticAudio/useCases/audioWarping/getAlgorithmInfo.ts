import { type WarpAlgorithm } from '../../stores/audioWarp';

/**
 * Get the algorithm quality characteristics.
 */
export function getAlgorithmInfo(algorithm: WarpAlgorithm): {
    name: string;
    quality: 'high' | 'medium' | 'low';
    cpuCost: 'high' | 'medium' | 'low';
    bestFor: string;
    realTime: boolean;
} {
    const info: Record<
        WarpAlgorithm,
        {
            name: string;
            quality: 'high' | 'medium' | 'low';
            cpuCost: 'high' | 'medium' | 'low';
            bestFor: string;
            realTime: boolean;
        }
    > = {
        'elastique-pro': {
            name: 'élastique Pro',
            quality: 'high',
            cpuCost: 'high',
            bestFor: 'General purpose, mixed content',
            realTime: true,
        },
        'elastique-efficient': {
            name: 'élastique Efficient',
            quality: 'medium',
            cpuCost: 'low',
            bestFor: 'Real-time with many tracks',
            realTime: true,
        },
        'elastique-soloist': {
            name: 'élastique Soloist',
            quality: 'high',
            cpuCost: 'medium',
            bestFor: 'Solo instruments, vocals',
            realTime: true,
        },
        'rubber-band-r3': {
            name: 'Rubber Band R3',
            quality: 'high',
            cpuCost: 'high',
            bestFor: 'Offline rendering, highest quality',
            realTime: false,
        },
        'rubber-band-rt': {
            name: 'Rubber Band RT',
            quality: 'medium',
            cpuCost: 'medium',
            bestFor: 'Real-time stretching',
            realTime: true,
        },
        complex: {
            name: 'Complex',
            quality: 'medium',
            cpuCost: 'medium',
            bestFor: 'Mixed content, full mixes',
            realTime: true,
        },
        'complex-pro': {
            name: 'Complex Pro',
            quality: 'high',
            cpuCost: 'high',
            bestFor: 'Full mixes with formant preservation',
            realTime: true,
        },
        repitch: {
            name: 'Re-Pitch',
            quality: 'low',
            cpuCost: 'low',
            bestFor: 'Simple speed changes, vinyl effect',
            realTime: true,
        },
        slice: {
            name: 'Beat Slice',
            quality: 'medium',
            cpuCost: 'low',
            bestFor: 'Drums, percussive content',
            realTime: true,
        },
    };

    return info[algorithm];
}
