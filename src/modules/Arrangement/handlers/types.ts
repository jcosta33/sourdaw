import { type AppAction } from '#/modules/Command';

export type ExtractAction<A extends AppAction, T extends string> = A extends { type: T } ? A : never;
