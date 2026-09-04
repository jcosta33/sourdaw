import { type AppAction } from '#/utils/handlerContract';

import { type RuntimeAction } from './RuntimeAction';

export type ExecutableRuntimeAction = AppAction;

type CreationActionType = 'createBus' | 'addDevice' | 'addTrack' | 'addClip';
type CreationRuntimeAction = Extract<RuntimeAction, { type: CreationActionType }>;
type CreationAppAction = Extract<AppAction, { type: CreationActionType }>;

export type MaterializableRuntimeAction = Exclude<RuntimeAction, CreationRuntimeAction> | CreationAppAction;
