# Install the chat (step 7)

Follow this exactly; don't improvise. The diff stays small: the dependency, the config, one chat screen, one
way to open it. Don't restructure the app.

## What every app needs

| | |
|---|---|
| Server | `https://sdk.oson.ai` |
| App key | `osk_pub_…` from the developer (osonai dashboard). If they haven't given it, write `osk_pub_REPLACE_ME` and say so. It is not a secret: it ships in the app. |
| Manifest, design | `harness/manifest.json`, `harness/design.json`, shipped inside the app |
| Tools | the bindings from step 4 |
| Context | the `context` names of the manifest, kept current by the app |

Put the server and key next to the app's other config (constants file, `.env` the app already reads,
`BuildConfig`, `Info.plist`). Never in the chat screen itself.

## React Native

1. **Dependencies:** `npm install @osonai/react-native react-native-webview` (or the app's package manager).
   Then, if the app has an `ios/` folder: `cd ios && pod install` (macOS only; otherwise tell
   the developer to run it).
2. **Config:** add `OSONAI_URL` and `OSONAI_APP_KEY` to the app's config module (create `src/osonai.config.ts`
   if there is none):
   ```ts
   export const OSONAI_URL = 'https://sdk.oson.ai';
   export const OSONAI_APP_KEY = 'osk_pub_…';
   ```
3. **Chat screen:** copy `<skill-dir>/assets/react-native/OsonaiScreen.tsx` into the app's screens folder.
   Replace `__HARNESS__` with the relative path to `harness/`, `__CONFIG__` with the config module, and
   `__TITLE__` with "<App name> assistant". Change nothing else. If the app's `tsconfig` lacks
   `"resolveJsonModule": true`, add it.
4. **Open it:** register the screen in the app's navigator the same way its other screens are (an app with its
   own navigation, no library: add a route next to the others), and add one way to reach it where the app keeps
   its main actions: a tab, a header button, or a button labelled "Ask". If the screen is not inside the
   app's safe area already, wrap it in a view with the safe-area insets as padding and the app's background
   color. Pass:
   - `context`: the manifest's `context` values from the current screen (route name, the open item's id
     and name);
   - `onClose`: go back;
   - `onOpen`: for each `view.open` kind in the manifest, navigate to that item's screen.
5. **Typecheck:** `npx tsc --noEmit`.

## Android

1. **Dependency:** add `maven("https://jitpack.io")` to the repositories in `settings.gradle.kts` (if it isn't
   there), and `implementation("com.github.zohidjon-m:osonai:0.1.0")` to the app module.
2. **Config:** `OSONAI_URL` and `OSONAI_APP_KEY` as `buildConfigField`s (or the app's own config object).
3. **Manifest and design:** copy `harness/manifest.json` and `harness/design.json` into
   `app/src/main/assets/osonai/`. Say that the copies must be refreshed when the harness changes (or add a
   Gradle `copy` task if the app already uses such tasks).
4. **Chat screen:** one `OsonaiActivity` (or a Compose screen) that creates
   `Osonai(OsonaiConfig(runtimeUrl, appKey, manifestJson, designJson = …, views = true))` after sign-in,
   registers `OsonaiTools(...).all.forEach { (name, fn) -> osonai.tool(name, fn) }`, and shows
   `OsonaiChatView(context, osonai)`. Call `osonai.release()` in `onDestroy`. Full API: the SDK's
   `packages/android/README.md`.
5. **Open it:** one entry point (menu item, button). Keep `osonai.context` current from the open screen.
6. **Compile:** `./gradlew assembleDebug`.

## iOS

1. **Dependency:** the Swift package `https://github.com/zohidjon-m/osonai`, from `0.1.0`, product `OsonaiSDK`.
   Editing `project.pbxproj` by hand breaks projects: tell the developer to add it (Xcode → File → Add Package
   Dependencies), unless the app uses `Package.swift` or XcodeGen / Tuist, where you add it in that file.
2. **Config:** `OSONAI_URL` and `OSONAI_APP_KEY` in the app's config (constants file or `Info.plist`).
3. **Manifest and design:** add `harness/manifest.json` and `harness/design.json` to the app bundle (an Xcode
   16 synchronized folder picks them up; otherwise tell the developer to add them to the target).
4. **Chat screen:** one `Osonai(config: OsonaiConfig(...))` after sign-in, register
   `OsonaiTools.all(...)` with `osonai.tool(name, fn)`, show `OsonaiChatView(osonai:)` full screen with
   `.ignoresSafeArea()`. Full API: the SDK's `packages/ios/README.md`.
5. **Open it:** one entry point. Keep `osonai.context` current.
6. **Compile:** `xcodebuild build` (macOS only; otherwise say it was not compiled).

## Never

- Run the app against the live server with the developer's real account.
- Claim it builds when you couldn't run the build.
