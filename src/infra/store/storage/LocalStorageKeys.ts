/* (c) Copyright Sourdaw Ltd., all rights reserved. */

/*****************************************************************************
 * THESE KEYS HAVE LEGAL IMPLICATIONS!                                       *
 *                                                                           *
 * Since we are required by law to be transparent about cookies and          *
 * LocalStorage data in our Cookie Policy, we have to track all used         *
 * keys here.                                                                *
 *                                                                           *
 * Any addition, deletion or change of keys needs to be reported to          *
 * the legal department (Carmen Cuomo) including the keys name and           *
 * its purpose.                                                              *
 *****************************************************************************/
export type LocalStorageKey =
    // Stores the brand search query
    | 'navigationBrandsSearch'

    // Stores the dismissed toast messages about project privacy
    | `dismissed-personal-project-privacy-toast-${string}`

    // stores the dismissed page banners
    | 'dismissedPageBanners'

    // Stores the port used by the local development block (per block basis)
    | `local-block-development-port-${string}`

    // Stores document edit mode 'view' or 'edit'
    | 'local-edit-mode'

    // Allow users to get a list of previously visited documents on a 404 error page.
    | 'document-page-hits'

    // Controls section navigation within brands
    | 'navViewSection'

    // Stores the navigation sidebar state
    | 'navigation-sidebar-state'

    // Stores the current sorting state of the library view
    | `libraryViewSorting-${number}`

    // Stores the view type of the brand content list
    | 'brandContentListingView'

    // Stores the sidebar visibility in single asset view
    | 'hiddenSidebarOnSingleAssetView'

    // Flags the 'no theme in guideline section layout' as dismissed
    | 'dismiss-guideline-section-layout-no-theme-notice'

    // Stores the current block in action in the content manager
    | 'blockInAction'

    // Flags the asset name change warning as hidden
    | 'hide_asset_name_change_warning'

    // Flag is set when we show the collection in the library view
    | 'showCollections'

    // Flag is set when we show the sidebar in library view
    | 'librarySidebar'

    // Stores the current marketplace layout
    | 'MARKETPLACE_LAYOUT'

    // Stores font metrics extracted from template fonts, keyed by font family
    | `fontMetricData:${string}`

    // Stores the brand id in the asset chooser
    | 'assetchooser_brand_id'

    // Stores the accordion states in asset viewer
    | 'asset-viewer:accordion'

    // Indicates if we can show the local development menu for the platform apps
    | 'development-app'

    // Object that describes an app that starts in local development for the platform apps
    | 'local-app-development'

    // Stores the dismissed notice for automation executions
    | 'dismissed-automation-executions-notice'

    // Stores whether the comment guideline notice has been dismissed
    | 'dismiss-guidelines-comment-notice'

    // ========================== ONLY INTERNAL KEYS ==========================

    // Toggle for the developer mode of platform apps
    | 'developer-mode'

    // [Dev] DevTools settings (visibility, activeTab, reactScanStatus, fpsMeterState, triggerPosition)
    | 'sourdaw-devtools-settings'

    // ========================== DAW KEYS ====================================

    // Stores user preferences (theme, audio device, track height, etc.)
    | 'sourdaw-preferences'

    // Stores the current project state
    | 'sourdaw-project'

    // Stores list of recently opened projects
    | 'sourdaw-recent-projects'
    | 'sourdaw:recent-projects'

    // Stores user-created sound presets
    | 'sourdaw-user-presets'

    // Stores user-saved track templates
    | 'sourdaw:track-templates'

    // Stores last-used export dialog settings
    | 'sourdaw-export-settings'

    // Stores the sidebar collapsed/expanded state
    | 'sourdaw-sidebar-state'

    // Stores project branch metadata (branch registry)
    | 'sourdaw-branches'

    // Stores AI action history (undo groups, timestamps, prompts)
    | 'sourdaw-ai-history'

    // Stores user-defined keyboard shortcuts
    | 'sourdaw-shortcuts'

    // Stores if the user has dismissed the alpha notice modal
    | 'sourdaw-alpha-notice-dismissed';
