/**
 * Shell-side admission for renderer plugin commands during quit.
 *
 * The native shutdown cascade drains live plugin stores synchronously on the
 * JS thread and cannot take the async runtime gate without wedging exit. Closing
 * admission here, before `shutdown()` is called, is what keeps a `load_plugin`
 * still in flight from inserting an instance after the drain.
 */

/** Exposed commands whose bodies touch live plugin runtimes or start plugin work. */
export const PLUGIN_RUNTIME_COMMANDS = [
    'close_plugin_gui',
    'get_plugin_parameters',
    'get_plugin_state_bytes',
    'load_plugin',
    'open_plugin_gui',
    'process_plugin_audio',
    'scan_plugins',
    'set_plugin_bypass',
    'set_plugin_parameter',
    'set_plugin_state_bytes',
    'unload_plugin',
] as const;

export type PluginRuntimeCommand = (typeof PLUGIN_RUNTIME_COMMANDS)[number];

const PLUGIN_RUNTIME_COMMAND_SET: ReadonlySet<string> = new Set<string>(PLUGIN_RUNTIME_COMMANDS);

/** Whether a renderer command name touches the plugin runtime surface. */
export const isPluginRuntimeCommand = (command: string): command is PluginRuntimeCommand =>
    PLUGIN_RUNTIME_COMMAND_SET.has(command);

export type PluginCommandAdmission = {
    /** Whether the shell may still route this command to its backend. */
    readonly acceptsCommand: (command: string) => boolean;
    /** Called once when quit begins, before the native shutdown cascade. */
    readonly refusePluginCommands: () => void;
};

export const createPluginCommandAdmission = (): PluginCommandAdmission => {
    let accepting = true;

    return {
        acceptsCommand: (command) => !isPluginRuntimeCommand(command) || accepting,
        refusePluginCommands: () => {
            accepting = false;
        },
    };
};
