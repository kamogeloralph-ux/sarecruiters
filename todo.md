# SMART MANAGER — Agency Self-Service Links

## Implementation Tasks
- [x] Token helper functions (genToken, getManagerToken, setManagerToken, agencyIdFromToken, buildManagerLink)
- [x] Auto-generate token in saveAgency() for new agencies
- [x] Backfill tokens for existing agencies in loadAll()
- [x] Add SMART MANAGER screen HTML (admin-only, shows agency links with copy/share)
- [x] Add Manager Mode screen HTML (restricted add-only interface for agency)
- [x] Add CSS for manager mode + smart manager section
- [x] Add JS: enterManagerMode() URL detection on page load
- [x] Add JS: renderManagerMode() — simplified add-only UI
- [x] Add JS: renderSmartManager() — admin list of agency links
- [x] Add "SMART MANAGER" menu item in Profile (admin only)
- [x] Add manager-mode save functions (add-only, no edit/delete)
- [x] Bump service worker cache to v12
- [x] Test admin sees links + agency link opens restricted mode
- [x] Screenshot and present to user
