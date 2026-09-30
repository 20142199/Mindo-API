# Design QA — Admin account menu and password dialog

- Source visual truth: `/var/folders/p7/tss0w0ps4gd7_tpsj9p5vpdc0000gn/T/TemporaryItems/NSIRD_screencaptureui_mflwt9/Screenshot 2026-09-30 at 19.56.51.png`
- Implementation screenshot: Codex in-app browser capture of `https://admin-mindo.stg-studio.com/ai-experts`
- Browser verification: Codex in-app browser on production.
- Source pixels: 338 × 156; visually a 2× crop, normalized CSS region about 169 × 78.
- Implementation pixels / viewport: 1280 × 720 screenshot, 1280 × 720 CSS viewport, reported device pixel ratio 2.
- State: authenticated desktop admin; closed account control, open dropdown, and open change-password dialog.

## Full-view comparison evidence

The implementation retains the white top bar, left divider, pale-blue 42 px circular avatar, navy account name, muted role and right-aligned chevron from the source. The menu opens beneath the account control without shifting the page.

## Focused region comparison evidence

- Source avatar normalizes to 42 px; implementation measured at 42 px.
- Source name/role hierarchy normalizes to approximately 14 px/11 px; implementation uses 14 px/11 px.
- The account control is keyboard-focusable and exposes its expanded state.
- The dropdown and password dialog use the existing Mindo navy, pale-blue surfaces, border radii, shadows and Lucide icon family.
- No raster imagery or custom-drawn substitute assets are involved in this UI.

## Findings

No actionable P0/P1/P2 visual differences remain for the requested account control. The source does not define the dropdown or dialog states; those states intentionally extend the existing admin design system.

## Comparison history

- Earlier finding (P2): the account area was static and the separate logout icon conflicted with the expected dropdown affordance.
- Fix: converted the whole profile area into an accessible menu button, moved logout into the menu, and added the change-password dialog.
- Earlier finding (P3): account typography appeared slightly smaller than the 2× source crop.
- Fix: aligned avatar/name/role text to 13 px/14 px/11 px.
- Post-fix evidence: production browser capture and measured 42 px avatar/account control geometry.

## Primary interactions and console checks

- Clicking the profile opens and closes the account dropdown.
- “Đổi mật khẩu” opens the dialog containing current, new and confirmation fields.
- Show/hide password controls are present for all three inputs.
- A mismatched confirmation is blocked client-side with a Vietnamese error.
- The success flow clears the local session and requires login with the new password.
- Browser console check returned no errors or warnings.
- API/admin builds and automated tests pass.

final result: passed
