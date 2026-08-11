import { type AppAction } from '#/utils/handlerContract';

import { type RuntimeAction } from './RuntimeAction';

export type ExecutableRuntimeAction = AppAction;

type CreateBusRuntimeAction = Extract<RuntimeAction, { type: 'createBus' }>;
type CreateBusAppAction = Extract<AppAction, { type: 'createBus' }>;
type AddDeviceRuntimeAction = Extract<RuntimeAction, { type: 'addDevice' }>;
type AddDeviceAppAction = Extract<AppAction, { type: 'addDevice' }>;

export type MaterializableRuntimeAction =
    Exclude<RuntimeAction, CreateBusRuntimeAction | AddDeviceRuntimeAction> | CreateBusAppAction | AddDeviceAppAction;
