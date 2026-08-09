import { type AppAction } from '#/utils/handlerContract';

import { type RuntimeAction } from './RuntimeAction';

export type ExecutableRuntimeAction = AppAction;

type CreateBusRuntimeAction = Extract<RuntimeAction, { type: 'createBus' }>;
type CreateBusAppAction = Extract<AppAction, { type: 'createBus' }>;

export type MaterializableRuntimeAction = Exclude<RuntimeAction, CreateBusRuntimeAction> | CreateBusAppAction;
