import { type AppAction } from '../../models/AppAction';
import { type CommandEntry } from '../../models/CommandEntry';

export type CommandAction = AppAction | (() => void);
export type CallableCommandEntry = CommandEntry<CommandAction>;
