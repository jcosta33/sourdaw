import { type AppAction } from '#/utils/handlerContract';

export type ExtractAction<Action extends AppAction, TypeString extends string> = Action extends { type: TypeString }
    ? Action
    : never;
