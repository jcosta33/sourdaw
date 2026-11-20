import { type AppAction } from '#/utils/handlerContract';

export type RelinkTarget = Extract<AppAction, { type: 'relinkClipAudioSources' }>['payload']['targets'][number];
export const RELINK_AUDIO_SOURCE_KEYS = [
    'audioBufferId',
    'fileId',
    'assetHash',
    'audioOffsetBeats',
    'audioOffsetSeconds',
    'audioUnwrappedOffsetSeconds',
    'audioLoopStartSeconds',
    'audioLoopPassEntrySeconds',
    'audioLoopPassOriginBeat',
    'stretchMode',
    'stretchRatio',
    'loopEnabled',
    'loopLength',
    'loopOriginBeat',
] as const;
