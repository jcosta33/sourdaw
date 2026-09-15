/**
 * The audio-extension law: the one set of filename extensions the whole app
 * treats as an audio file. It lives here because several modules must agree on
 * it — a module re-declaring its own copy is how `.wave` and `.opus` files came
 * to be accepted by library indexing and silently rejected by browser import.
 */

export const AUDIO_EXTENSIONS = new Set([
    'wav',
    'wave',
    'mp3',
    'ogg',
    'flac',
    'aiff',
    'aif',
    'aac',
    'm4a',
    'webm',
    'opus',
]);

/** Whether a filename carries one of {@link AUDIO_EXTENSIONS}, case-insensitively. */
export function isAudioFile(filename: string): boolean {
    const ext = filename.split('.').pop()?.toLowerCase() ?? '';
    return AUDIO_EXTENSIONS.has(ext);
}
