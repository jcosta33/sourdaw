/**
 * Layout registration entry point.
 *
 * Import this module to ensure all device layouts are registered
 * in the deviceLayoutRegistry before DeviceInspector renders.
 * Each layout file self-registers via registerDeviceLayout / registerPrefixLayout.
 */

// Instrument layouts
import './BuiltinSynthLayout';
import './FaustInstrumentLayout';
