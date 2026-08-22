import { getWindowChromeControls, type WindowChromeControls } from '../repositories/windowChrome';

/** The frameless desktop window chrome's controls, for the header's own buttons. */
export function windowChromeControls(): WindowChromeControls {
    return getWindowChromeControls();
}
