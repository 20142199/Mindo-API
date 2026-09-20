# Design QA — Desktop login inputs

- Source visual truth: `/var/folders/p7/tss0w0ps4gd7_tpsj9p5vpdc0000gn/T/TemporaryItems/NSIRD_screencaptureui_M4mmzO/Screenshot 2026-09-21 at 05.19.00.png`
- Implementation screenshot: `/private/tmp/mindo-login-input-revised.png`
- Browser verification: Codex in-app browser, `http://127.0.0.1:5174/`
- Source pixels: 886 × 898. The source appears to be a 2× crop; the 96 px input maps to a 48 px CSS control.
- Implementation pixels / viewport: 886 × 898 at device scale factor 1.
- State: desktop login, empty email and password inputs.

## Full-view comparison evidence

The implementation keeps the existing Mindo desktop split layout while matching the reference's desktop control density. The input height is now 48 px rather than the 56 px mobile control height. The navy product identity remains intentional and outside the scope of this input-only change.

## Focused input comparison evidence

- Height: reference normalized to 48 px; implementation computed at 48 px.
- Background: reference white; implementation `rgb(255, 255, 255)`.
- Border: reference thin light gray; implementation `1px solid rgb(223, 228, 234)`.
- Radius: reference medium rounded corners; implementation 11 px.
- Icons: reduced to 19 px with a lighter gray treatment.
- Mobile behavior: the existing 56 px / 16 px-radius touch controls remain under the mobile breakpoint.

## Findings

No actionable P0/P1/P2 differences remain for the requested desktop input treatment.

## Comparison history

- Earlier finding (P2): desktop used the mobile 56 px control height, 16 px radius, and filled gray surface.
- Fix: changed desktop inputs to 48 px, 11 px radius, white surface, thinner border, and smaller icons; retained mobile dimensions in the responsive override.
- Post-fix evidence: `/private/tmp/mindo-login-input-revised.png`; computed browser dimensions confirm 48 px height.

## Primary interaction and console checks

- Email and password fields remain editable.
- Password visibility button remains available.
- Login submit action remains wired to the existing API.
- Browser console check returned no errors or warnings.
- Build and automated Admin tests pass.

final result: passed
