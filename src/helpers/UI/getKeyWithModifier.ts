/* (c) Copyright Frontify Ltd., all rights reserved. */

const isMacOs = () => navigator.platform.toUpperCase().includes('MAC');

export const getKeyWithModifier = (key: string) => {
    return isMacOs()
        ? {
              meta: `⌘${key}`,
              opt: `⌥${key}`,
              shift: `⇧${key}`,
          }
        : {
              meta: `Ctrl+${key}`,
              opt: `Alt+${key}`,
              shift: `Shift+${key}`,
          };
};
