/* (c) Copyright Frontify Ltd., all rights reserved. */

/*****************************************************************************
 * THESE KEYS HAVE LEGAL IMPLICATIONS!                                       *
 *                                                                           *
 * Since we are required by law to be transparent about cookies and          *
 * sessionStorage data in our Cookie Policy, we have to track all used         *
 * keys here.                                                                *
 *                                                                           *
 * Any addition, deletion or change of keys needs to be reported to          *
 * the legal department (Carmen Cuomo) including the keys name and           *
 * its purpose.                                                              *
 *****************************************************************************/
export type SessionStorageKey =
    // Stores the backend asset viewer zoom percent
    | 'editorZoomPercent'

    // Stores the navigation manager visibility state
    | 'nm-open'

    // Stores the dismissed toast messages in the theme settings sidebar
    | 'themeSettingsInfoToast'

    // Stores which tree items were selected in the apply template settings dialog
    | `templateSettingsApplyTo-${string}`

    // Stores the template editor timeline height per asset
    | 'timelineHeight'

    // Stores the migration dialog on edit visibility state per guideline
    | 'migration-on-edit'

    // Stores the migration dialog notice visibility state per dialog type and guideline
    | 'migration-notice-visible'

    // Stores the two factor authentication state to allow for access of the 2fa page after login
    | 'two-factor-authentication-state'

    // Stores the info notice visibility state in the Brand Essentials Fonts module
    | 'essentials-fonts-info-notice';
