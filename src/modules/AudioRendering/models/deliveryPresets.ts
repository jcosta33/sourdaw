import { type DeliveryPreset } from './DeliveryTarget';

/** Factory starting points, not upload mandates or platform certification. */
export const DELIVERY_PRESETS = [
    {
        id: 'spotify-stereo-master',
        name: 'Spotify stereo master',
        description: 'Lossless stereo starting point. Keep the source rate; target -14 LUFS before encoding.',
        metadataFields: [],
        settings: {
            formats: ['flac'],
            sampleRate: 'source',
            bitDepth: 24,
            channels: 2,
            mp3BitRate: 192,
            normalization: 'r128',
            targetLufs: -14,
            ceilingDbTp: -1,
        },
    },
    {
        id: 'apple-music-stereo-master',
        name: 'Apple Music stereo master',
        description:
            'Sourdaw stereo starting point at the source rate and -16 LUFS; not an Apple upload mandate or Apple Digital Masters certification.',
        metadataFields: [],
        settings: {
            formats: ['wav'],
            sampleRate: 'source',
            bitDepth: 24,
            channels: 2,
            mp3BitRate: 192,
            normalization: 'r128',
            targetLufs: -16,
            ceilingDbTp: -1,
        },
    },
    {
        id: 'youtube-audio-master',
        name: 'YouTube audio master for video',
        description:
            '48 kHz audio to combine with video. The -14 LUFS target is a Sourdaw starting point; this exports audio only.',
        metadataFields: [],
        settings: {
            formats: ['wav'],
            sampleRate: 48000,
            bitDepth: 24,
            channels: 2,
            mp3BitRate: 192,
            normalization: 'r128',
            targetLufs: -14,
            ceilingDbTp: -1,
        },
    },
    {
        id: 'podcast-rss-mp3',
        name: 'Podcast RSS MP3',
        description:
            'RSS-oriented stereo MP3 with episode tags. Loudness and peak targets apply before encoding; MP3 can alter peaks. MP3 has no delivered PCM bit depth.',
        metadataFields: ['title', 'artist', 'description'],
        settings: {
            formats: ['mp3'],
            sampleRate: 44100,
            bitDepth: 24,
            channels: 2,
            mp3BitRate: 192,
            normalization: 'r128',
            targetLufs: -16,
            ceilingDbTp: -1,
        },
    },
    {
        id: 'game-audio-pcm',
        name: 'Game Audio PCM',
        description:
            '48 kHz PCM starting point, normalization off. Choose mono when needed; there is no universal game loudness target. No Wwise/FMOD project or regions are exported.',
        metadataFields: [],
        settings: {
            formats: ['wav'],
            sampleRate: 48000,
            bitDepth: 24,
            channels: 2,
            mp3BitRate: 192,
            normalization: 'off',
            targetLufs: -23,
            ceilingDbTp: -1,
        },
    },
] as const satisfies readonly DeliveryPreset[];
