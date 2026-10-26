import { type ExportSettings } from './exportSettings';

/** An RSS-oriented MP3 starting point; targets describe PCM before lossy encoding. */
export const PODCAST_RSS_MP3_PRESET = {
    id: 'podcast-rss-mp3',
    name: 'Podcast RSS MP3',
    channels: 2,
    ceilingDbTp: -1,
    settings: {
        formats: ['mp3'],
        sampleRate: 44100,
        bitDepth: 24,
        mp3BitRate: 192,
        normalization: 'r128',
        targetLufs: -16,
    },
} as const satisfies {
    id: string;
    name: string;
    channels: number;
    ceilingDbTp: number;
    settings: Omit<ExportSettings, 'dither'>;
};
