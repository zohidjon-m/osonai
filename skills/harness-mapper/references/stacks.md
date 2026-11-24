# Stacks

Read only the section for the app's stack.

| Evidence | Stack |
|---|---|
| `package.json` with `react-native` or `expo` | React Native |
| `build.gradle(.kts)` with `com.android.application`, Kotlin sources | Android |
| `*.xcodeproj` or `Package.swift`, Swift sources | iOS |

Anything else (Flutter, web, a backend alone): the SDK doesn't support it yet. Say so and stop.

If the backend is in the same repo, you may read it for parameter types and permission checks, but bind
every tool to the **app's** code.

## React Native / Expo

**Screens:** React Navigation (`createNativeStackNavigator`, `Tab.Screen name=…`) or Expo Router (files in
`app/`). That list is your screen order for step 2.

**Where the work happens:**
- API client: `src/api`, `src/services`, `lib/api` (`axios.create`, `fetch` wrappers, generated clients).
- TanStack Query: `useMutation({ mutationFn })` → bind to the `mutationFn` target, and call the same
  `queryClient.invalidateQueries` the `onSuccess` does. `useQuery({ queryFn })` → a read tool.
- Redux Toolkit: `store.dispatch(thunk(args)).unwrap()`, or RTK Query `api.endpoints.x.initiate(args)`.
- Zustand: `useStore.getState().action(...)` works outside components.
- Context providers: their logic lives in a component; bind to the service the provider calls.

**Navigation from a binding:** needs a navigation ref (`createNavigationContainerRef`) or Expo Router's
`router`. If the app has neither, put `navigate` tools in `gaps` and say a ref is needed.

**Labels:** `i18next` / `react-intl` keys → resolve to the text in the main language.

**Session:** check that the API client adds the token itself (interceptor, wrapper). Then bindings need
nothing for auth.

**Local actions:** `expo-speech`, `Clipboard`, `Share`.

**Bindings file:** `harness/bindings.ts`, exporting `tools`. Typecheck: `npx tsc --noEmit`.

## Android (Kotlin)

**Screens:** the Navigation graph (`nav_graph.xml`, Compose `NavHost` routes), activities in
`AndroidManifest.xml`.

**Where the work happens:** a `ViewModel` method calls a repository or a Retrofit / Ktor service. Bind to the
**repository or service** (injected with Hilt or Koin, or a singleton), not to a screen's ViewModel. If the
ViewModel refreshes a `StateFlow` after the call, note it in `notes`.

**Navigation from a binding:** only if the app has a navigator it can reach outside a screen. Otherwise
`navigate` tools go in `gaps`.

**Labels:** `res/values/strings.xml`.

**Local actions:** `TextToSpeech`, `ClipboardManager`, share intents.

**Bindings file:** `OsonaiTools.kt` in the app module's sources, in a package `<app package>.osonai`
(`app/src/main/java/com/example/shop/osonai/OsonaiTools.kt`). Its constructor takes what the functions need
(repositories). Compile: `./gradlew compileDebugKotlin`.

## iOS (Swift)

**Screens:** `NavigationStack` paths, tab views, coordinators.

**Where the work happens:** service or repository classes (`URLSession` wrappers, Alamofire, generated
OpenAPI clients) that view models call. Bind to the **service**, not the view model. TCA: send actions to the
root store if the app can reach it.

**Existing App Intents** (`AppIntent` structs) are ready-made actions with parameters and titles: good
sources.

**Navigation from a binding:** only if the app has a router or coordinator it can reach outside a view.
Otherwise `navigate` tools go in `gaps`.

**Labels:** `Localizable.strings` / `.xcstrings`.

**Local actions:** `AVSpeechSynthesizer`, `UIPasteboard`, `ShareLink`.

**Bindings file:** `OsonaiTools.swift` in the app target's folder (`<App>/Osonai/OsonaiTools.swift`). Xcode 16
folders pick it up; in an older project it must be added to the target: don't edit `project.pbxproj`, tell
the developer. Compile: `xcodebuild build` (macOS only; on another OS say it was not compiled).
