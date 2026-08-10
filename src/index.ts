// @trf/ui — compatibility shim.
//
// The components and the SideMenu that used to live here were replaced by
// @trf/ui2 and @trf/app-shell. What remains is the infrastructure app-shell and
// the frontends still import: translations, discovery-menu fetching, logout.
// Do not add UI to this package — new components belong in @trf/ui2.
export { DEFAULT_DISCOVERY_MENU_GROUP, DEFAULT_DISCOVERY_MENU_URL } from "./config";
export { fetchDiscoveryMenu, fetchDiscoveryMenuItems, mapDiscoveryMenuToMenuItems, mapDiscoveryMenuResponse } from "./discoveryClient";
export type { DiscoveryMenuResult } from "./discoveryClient";
export type { AppBaseUrls, AppId, DiscoveryMenuConfig, MenuItem } from "./types";
export { TRF_UI_VERSION } from "./version";
export { logout } from "./logout";
export { TranslationClient } from "./translationClient";
