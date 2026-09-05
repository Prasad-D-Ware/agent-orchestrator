# Android — Google Play Setup Plan (AO Mobile)

Getting AO Mobile onto Google Play, mirroring the iOS/TestFlight journey (fast
testing first, full store listing later). Google Play and Apple are independent.

> **Status (2026-07-25):** Rebuilt on a **fresh Google Play account** after the
> previous account (**splitly**) was closed for inactivity. See Phase 0 for the
> full history and what changed. Current package: **`aoagents.dev`**. FCM V1
> push credential is wired to EAS.
>
> **✅ Done (2026-07-25):**
> - Android production AAB + iOS production builds both succeeded (using the
>   `google-services.json` dance below for Android).
> - Android AAB uploaded to Play **Internal testing** → release "AO - Mobile
>   Beta" active; installed on-device via the opt-in link.
> - **Android push VERIFIED end-to-end on `aoagents.dev`** — a direct Expo push
>   to the registered device token returned an `ok` receipt AND arrived on the
>   device. New package + new Firebase project (`ao---mobile`) + new FCM V1
>   credential all deliver correctly. (See "Push verification notes" below for
>   the one gotcha about `needs_input`.)
> - iOS submitted to **TestFlight** (`eas submit -p ios`).
> - **Closed testing LIVE (approved 2026-07-27).** Track "AO - Mobile Alpha"
>   (promoted from internal — bundle version code 3). Testers managed via a
>   public self-join **Google Group** `ao-mobile-testers@googlegroups.com`,
>   registered in Play. **21 authorized / 9 opted in.**
>
> **Next (critical path):** get **3+ more testers to OPTED IN** (opt-in link +
> install — group membership alone doesn't count) to reach **12**, which starts
> the **14-day clock**; hold ≥12 for 14 continuous days → apply for production /
> Open testing. Also: verify the real `needs_input` push via an AO-managed
> session (below); test the iOS build on TestFlight. See Phase 5 for the full
> closed-testing setup, join flows, and version-code gotcha.

## Account context (current)

- **New** Google Play developer account (the splitly account is gone — closed
  2026-07-22 for inactivity, taking the live Splitly app down with it).
- Because this is a **fresh personal account**, the "straight to production"
  exemption is **gone**. New personal accounts must run a **closed test with
  ≥12 testers for 14 continuous days** before production access unlocks.
  Internal testing is still available immediately.
- Android package: **`aoagents.dev`** (changed from the burned `aoagents.ao`,
  which is permanently reserved on the old/closed account).
- iOS bundle identifier stays **`aoagents.ao`** — already live on TestFlight,
  intentionally left untouched. Android and iOS identifiers now diverge; that's
  fine.

## Firebase / FCM context (current)

- **New Firebase project:** `ao---mobile` (Sender ID `334787776323`).
- `packages/mobile/google-services.json` is registered to **`aoagents.dev`**
  under this project (kept local + gitignored, re-included via `.easignore`).
- **FCM Cloud Messaging API (V1)** enabled; Legacy API disabled (deprecated —
  not used).
- **FCM V1 push credential uploaded to EAS** (done 2026-07-25): the
  `firebase-adminsdk-fbsvc@ao---mobile.iam.gserviceaccount.com` service-account
  JSON key, assigned to `aoagents.dev` for FCM V1. This is what lets Expo
  deliver Android push. Verify anytime with `npx eas-cli credentials` → Android
  → Google Service Account → FCM V1.

## Key difference from iOS

- Play Store builds are **AAB** (App Bundle), not APK. The EAS `production`
  profile builds an AAB; `preview` builds a sideloadable APK.
- No entitlement / `EXPO_NO_CAPABILITY_SYNC` drama — Android is simpler here.

---

## Testing tracks (pick per goal)

| Track | Testers | Join method | Review | Store listing |
|-------|---------|-------------|--------|---------------|
| **Internal** | ≤100, by email | email opt-in link | none (instant) | minimal |
| **Closed** | email lists / Google Groups | opt-in link | light | fuller |
| **Open** | unlimited, **public link** | public opt-in URL | yes | full |

- **Internal** = the quick sanity check (Play equivalent of TestFlight internal).
  Available immediately on the new account.
- **Closed** = now **mandatory** as the 14-day / ≥12-tester gate before
  production (and, in practice, before Open) on a new personal account.
- **Open** = the public shareable link for the Discord community — gated behind
  the closed-test graduation + full store listing + compliance forms + review.

---

## Phase 0 — Account rebuild (history + what changed)
Context for why this doc was reset. Nothing to do here unless the appeal on the
old account succeeds.
- [x] Old account **splitly** closed 2026-07-22 (inactivity; warning deadline
      Jul 13 missed). Support ticket / appeal raised — outcome pending.
- [x] Created a **new** Google Play developer account.
- [x] New Android package **`aoagents.dev`** set in `app.json`
      (`android.package`); iOS `bundleIdentifier` left as `aoagents.ao`.
- [x] New Firebase project `ao---mobile`; new `google-services.json` for
      `aoagents.dev` dropped into `packages/mobile/`.
- [x] Uploaded the FCM V1 service-account key to EAS (push delivery).
- [ ] If the appeal reinstates splitly + Splitly, revisit whether to keep this
      new account or migrate back. Until then, proceed on the new account.

## Phase 1 — Create the app (new console)
- [ ] Play Console (new account) → **Create app**
  - Name: **AO Mobile** (final store name)
  - Default language, **App** (not game), **Free**
  - Accept Play policies + US export declarations
- [ ] Package `aoagents.dev` is set from the first AAB upload — nothing to type.

## Phase 2 — Build the AAB
- [ ] **First do the `google-services.json` dance (see gotcha below)** — the
      build fails without it.
- [ ] `cd packages/mobile && npx eas-cli build -p android --profile production`
  - `autoIncrement` bumps the Android version code automatically.
  - First build on this account: EAS sets up the Android **upload keystore**;
    on first Play upload, Play enrolls **Play App Signing** automatically.
  - Uses the local `google-services.json` (`ao---mobile` / `aoagents.dev`) for FCM.

### ⚠️ google-services.json build gotcha (READ THIS — it will cost you 2 builds otherwise)
EAS's git VCS client strips any file matching a `.gitignore` rule from the build
upload **even if the file is committed**. `google-services.json` is gitignored
(origin is public), so every build fails with:

> `"google-services.json" is missing, make sure that the file exists.`

The `!google-services.json` re-include in `.easignore` **does not fix this** —
verified false against real build history (build `55073d1f7` failed with the
line present; `d1df39e22` succeeded only after the `.gitignore` line was
removed).

**The file now reaches EAS Build as a file environment variable**, uploaded once
per project:

```bash
eas env:set --name GOOGLE_SERVICES_JSON --type file \
  --value ./google-services.json --visibility secret \
  --environment preview --environment production
```

`packages/mobile/app.config.js` copies whatever path EAS provides to the fixed
`./google-services.json` that `app.json` points at, then returns the config
unchanged. Locally the variable is unset (secret variables are not readable
outside EAS servers) and the file is simply already on disk. Nothing is
committed and `.gitignore` is never touched.

⚠️ **Do not go back to the temp-commit dance.** It required committing the file
*and* deleting the `google-services.json` line from `.gitignore` — and
`.gitignore` is a fingerprint input, so every build produced a runtime version no
normal working tree could reproduce (`84c9dff7` built vs `53ad3ec1` published on
2026-08-29). No OTA update would ever have matched such a build. It also put a
public-repo leak one `git push` away.

`.gitignore` is listed in `fingerprint.config.js` `ignorePaths` as belt-and-braces,
but the real fix is that nothing mutates it any more.

## Phase 3 — Verify push, then Internal testing (DONE 2026-07-25)
**Verify push before touching Play** — the package + Firebase project both
changed, so the FCM path was effectively new and had to be re-proven.
- [x] Uploaded the AAB to Play → **Internal testing → Create release → roll out**
      (adding testers is NOT enough; the release must be *rolled out*).
- [x] **Testers** tab → email list "AO - Mobile Beta" with the tester Gmail →
      save. (Reminder: you must press Enter to move a typed email into the
      "Email addresses added" list, else Save stays disabled.)
- [x] Opened the opt-in link, accepted, installed via the Play Store on-device
      (first internal release can take up to a few hours to become downloadable).
- [x] Enabled notifications in the app's **Settings** tab (the prompt is gated
      behind pairing; it fires from `registerForPush`).
- [x] **Push verified:** direct Expo push to the device token → `ok` receipt →
      arrived on device. Delivery chain (Expo → FCM → device) confirmed working
      on `aoagents.dev` / Firebase `ao---mobile`.

### Push verification notes (important gotcha)
- **"Induce a notification" only works from an AO-managed session.** The daemon
  creates the `needs_input` notification (→ push) only for sessions it spawned
  and tracks (worktrees under `~/.ao/data/worktrees/`, wired with AO's activity
  hooks). A **standalone Claude Code / terminal session waiting for input does
  NOT trigger a push** — the daemon isn't watching it. To test the real path:
  start a session *inside the Agent Orchestrator app*, let that agent stop for
  input, background the app → push arrives and deep-links into the session.
- **Foreground suppression (by design, D9):** the app hides the notification
  banner while it's in the foreground. Background the app / lock the phone to
  see it.
- **Diagnosing delivery independently of a session:** send a direct Expo push to
  the registered token and read the receipt —
  `curl -s https://exp.host/--/api/v2/push/send -H "Content-Type: application/json" -d '{"to":"<ExponentPushToken>","title":"t","body":"b","priority":"high","channelId":"default"}'`
  then `.../getReceipts` with the returned ticket id. `ok` receipt + arrival =
  delivery works; failure here points at FCM/token/credential. Registered tokens
  live in `~/.ao/data/mobile/push-devices.json` (timestamps are UTC).

## Phase 4 — Required declarations (for Closed/Open/Production)
Internal testing skips most of these; Closed/Open/Production require them.
Account-independent — the same forms apply on any account, so this work is safe
to prep now.
- [ ] **Privacy policy URL** — the GitHub Pages page (`docs/privacy-policy.html`
      already exists; publish it and use the URL).
- [ ] **Data safety** form — declare: Expo push token, LAN connection to the
      user's own server; no PII / no analytics / no ads.
- [ ] **Content rating** questionnaire.
- [ ] **Target audience & content**, **Ads** (none), **News** (no), etc.
- [ ] **Store listing:** short + full description, **app icon**, **feature
      graphic** (1024×500), phone **screenshots**.

## Phase 5 — Closed testing (mandatory 14-day gate) → Open testing
On a new personal account, Open/Production are gated behind a graduated closed
test. **Set up and IN PROGRESS as of 2026-07-27.**

### What's done
- [x] Closed testing track **"AO - Mobile Alpha"** created by **promoting the
      internal release** (a fresh AAB upload collided on "version code 3 already
      used"; promote reuses the same bundle and avoids that). See the version-code
      gotcha below.
- [x] App content + store listing completed and **submitted for review →
      approved**; closed track is live.
- [x] Tester management via a **Google Group** (scales better than hand-adding
      emails): group **`ao-mobile-testers@googlegroups.com`**, registered in
      Play → Closed testing → Testers → Google Groups → Save.
- [x] Group set to **public self-join**: Group settings → "Who can see group" =
      Anyone on the web, "Who can join group" = Anyone on the web can join.
      **21 members** so far.

### Tester join flows (two audiences)
- **New people (self-join):**
  1. `https://groups.google.com/g/ao-mobile-testers` → **sign in → click
     "About" → "Join group"** (the default Conversations tab shows a
     permission error because conversations are members-only — that is NOT a
     join blocker; join lives on About).
  2. `https://play.google.com/apps/testing/aoagents.dev` → **Become a tester**
     → install.
- **Existing group members:** skip step 1, just do the opt-in link (step 2).
- **Propagation delay:** after joining the group, Play takes minutes–~1h to
  authorize them, so the opt-in link may 404 briefly. Wait + retry.

### The 14-day requirement (what actually counts)
- Requirement: **≥12 testers OPTED IN, continuously, for 14 days** → then
  "Apply for production access" unlocks.
- **Group membership ≠ opted in.** Only testers who complete the opt-in link +
  install count. Status 2026-07-27: **21 authorized / 9 opted in** — need 3+
  more opt-ins to start the clock.
- Keep them opted in the whole window; if the count dips below 12 it can reset.
  Recruit spares (you have 21 authorized as buffer).
- **Genuine testing matters for the production review** (manual): testers should
  actually install and open the app a few times during the window — not
  necessarily daily, but not zero. Google bounces production applications that
  look like opt-in-only / no real engagement.
- **Note the date ≥12 opt-in is reached** — production eligibility is ~14 days
  later.

### After graduation
- [ ] **Apply for production access** (appears after 14 days with ≥12 opted in).
- [ ] Or **Open testing → Create release** → submit for review → share the
      **public opt-in URL** with the Discord community (single-link self-serve,
      unlike closed testing's two-link flow).

### Version-code gotcha (Play)
Every uploaded AAB must have a `versionCode` **unique and strictly higher** than
any bundle ever uploaded to this app, **across all tracks**. A fresh EAS build
that reproduces an already-used code fails "version code N has already been
used." Two fixes: (a) **promote** an existing release to the new track (reuses
the same bundle — what we did for closed), or (b) build a new AAB with a bumped
code. EAS remote versioning IS active here (`build:version:get -p android`
reported 3), so `autoIncrement` will produce the next code on the next build.

## Phase 6 — (Optional) automate uploads with `eas submit`
- [ ] This needs a **separate** service account — created in the **Play
      Console → Setup → API access** (NOT the Firebase FCM key from Phase 0).
      Grant it release permissions → download its JSON (keep local, gitignored).
- [ ] Wire into `eas.json`:
      `submit.production.android.serviceAccountKeyPath` → then
      `npx eas-cli submit -p android` uploads automatically (like the iOS
      `ascApiKey` setup already in `eas.json`).

---

## Recommended sequence
1. Phase 2: build the production AAB.
2. Phase 3: verify push on-device (new package + new Firebase project), then
   Internal testing — confirm the AAB installs + push works via Play.
3. Phase 4 + 5: fill compliance forms, then run the mandatory 14-day closed test
   to unlock production and the public Discord link.

## Notes / gotchas
- **Two different Google Service Account keys — don't confuse them:**
  - **FCM V1** key (`firebase-adminsdk`, from Firebase) = **push delivery**.
    Already uploaded to EAS.
  - **Play Store submission** key = a **separate** account from the Play Console
    (Phase 6). Do not reuse the FCM key for submissions.
- **Package rename risk:** `aoagents.ao` is permanently reserved on the closed
  account and cannot be reused. `aoagents.dev` is the replacement; the change
  lives in `app.json` (`android.package` only — iOS untouched).
- **New-account gate:** ≥12 testers, 14 continuous days of closed testing before
  production. Internal testing is exempt.
- **google-services.json:** kept local + re-included via `.easignore`; the EAS
  cloud build materializes it. Not in git.
- **Play App Signing:** let Google manage the signing key (default). EAS holds
  the upload key. Don't opt out.
- **eas-cli invocation:** the npm package is `eas-cli` but the binary is `eas`.
  It's not installed in this repo, so use `npx eas-cli <cmd>` (or
  `npm i -g eas-cli` for a plain `eas`).
- **First upload must be manual or via service account** — drag-drop the AAB in
  the console for the first release, then wire `eas submit` later.
- **Inactivity closure is the root cause here** — keep the new account active
  (publish something, don't let it sit >12 months) to avoid a repeat.
