import { getWindowChromeControls, type WindowChromeControls } from '../repositories/windowChrome';

/** The desktop window chrome the shell runs, with the frameless build's own buttons. */
export function windowChromeControls(): WindowChromeControls {
    return getWindowChromeControls();
}
