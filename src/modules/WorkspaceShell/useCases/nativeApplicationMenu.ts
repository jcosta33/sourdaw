import { nativeMenuDesktop } from '../repositories/nativeMenuDesktop';

/** Exposes the shell-owned native menu capability to WorkspaceShell presentation. */
export const nativeApplicationMenu = () => nativeMenuDesktop();
