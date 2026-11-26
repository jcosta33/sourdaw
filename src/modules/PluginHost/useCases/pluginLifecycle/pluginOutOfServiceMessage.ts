/**
 * What a slot whose plugin the host took out of service shows. The device row
 * already names the plugin, so the message carries only the reason.
 */
export function pluginOutOfServiceMessage(reason: string): string {
    return `Out of service: ${reason}.`;
}
