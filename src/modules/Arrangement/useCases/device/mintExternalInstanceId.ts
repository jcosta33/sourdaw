/** Mints the host instance id a hosted plugin device owns; one id per device, never shared. */
export function mintExternalInstanceId(pluginId: string): string {
    return `${pluginId}-${crypto.randomUUID()}`;
}
