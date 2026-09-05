# Android Closed Beta Landing Design

## Goal

Give Android visitors a polished closed-test enrollment experience equivalent to the existing iOS TestFlight flow.

## User flow

The `/download` mobile card replaces `Android coming soon` with a `Join the Android beta` button. The button opens a modal titled `Get AO Mobile on Android` with these steps:

1. Join the AO Mobile Android testers Google Group using the Google account used by Google Play.
2. Open the closed-test invite and tap `Become a tester`.
3. Install AO Mobile from the Play Store link shown after opting in.

The modal states that Group access may take up to an hour to propagate and asks testers to remain opted in for at least 14 continuous days. It does not claim that one tester leaving resets the test for everyone.

## Desktop-to-phone handoff

The modal displays one QR code pointing to `https://aoagents.dev/android-beta/`. That dedicated static page repeats the enrollment steps and exposes both external links, allowing a tester to join the Group, return to the AO page, and continue to Google Play on the same Android device.

## URLs

- Tester Group: `https://groups.google.com/g/ao-mobile-testers/about`
- Google Play opt-in: `https://play.google.com/apps/testing/aoagents.dev`
- AO handoff page: `https://aoagents.dev/android-beta/`

The URLs live in `@ao/shared/constants` so landing surfaces do not duplicate them.

## Components

- `AndroidBetaInstructions` is a deterministic, reusable instruction list shared by the modal and dedicated page.
- `AndroidBetaDialog` owns modal state, keyboard dismissal, scroll locking, transitions, QR rendering, and the trigger button.
- `/android-beta` is a static Next.js route optimized for completing the flow on a phone.

The existing TestFlight component remains unchanged to avoid unrelated iOS regression risk.

## Content and metadata

The download-page description expands from iOS-only beta wording to both iOS TestFlight and Android closed testing. `/android-beta` receives its own title and description.

## Verification

- Regression tests render the real instruction component and assert step order, exact external destinations, continuous-testing copy, and propagation guidance.
- A dialog test asserts the Android CTA is present in server-rendered markup.
- A route test asserts the dedicated page includes the instruction flow.
- Landing tests and an isolated TypeScript check must pass.
- A production build is attempted; the known missing `@mux/mux-player-react` dependency is reported if it remains the only blocker.

## Out of scope

- Electron `ConnectMobileGetApp` still uses the prior Android signup form.
- Google Play Console configuration and release management do not change.
- The iOS TestFlight flow does not change.
