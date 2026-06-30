import { isTauri } from '#/utils/tauriBridge';

type WriteAudioFileToCacheInput = {
    fileName: string;
    contents: ArrayBuffer;
};

type WriteAudioFileToCacheOutput = Promise<
    | {
          kind: 'ready';
          path: string;
      }
    | {
          kind: 'unavailable';
          error: unknown;
      }
    | {
          kind: 'skipped';
      }
>;

function sanitizeCacheFileName(name: string): string {
    const base = name.split(/[/\\]/).pop() ?? '';
    if (base === '' || base === '.' || base === '..') {
        return 'audio-file';
    }
    return base;
}

export async function writeAudioFileToCache({
    fileName,
    contents,
}: WriteAudioFileToCacheInput): WriteAudioFileToCacheOutput {
    if (!isTauri()) {
        return { kind: 'skipped' };
    }

    let invoke: typeof import('@tauri-apps/api/core').invoke;
    try {
        ({ invoke } = await import('@tauri-apps/api/core'));
    } catch (error) {
        return { kind: 'unavailable', error };
    }

    const modelDir = await invoke('get_model_dir');
    if (typeof modelDir !== 'string') {
        throw new TypeError('get_model_dir returned a non-string path');
    }
    const safeName = sanitizeCacheFileName(fileName);
    const path = `${modelDir}/../cache/${safeName}`;

    await invoke('write_audio_file', {
        path,
        data: new Uint8Array(contents),
    });

    return { kind: 'ready', path };
}
