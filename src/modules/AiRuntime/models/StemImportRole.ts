import { type AppAction } from '#/utils/handlerContract';

// Derived from the owner's action: a pure layer may not import Arrangement's events/.
export type StemImportRole = Extract<AppAction, { type: 'importStemSet' }>['payload']['stems'][number]['role'];
