---
name: harness-mapper
description: Map a mobile app's user actions (buttons, forms, screens) into tools an in-app chat agent can call as the signed-in user, and add the Osonai chat to the app. Writes harness/manifest.json, harness/bindings (the app's own functions, one per tool) and harness/design.json, then gives a short review list. Use when the user asks to map, expose or wrap app features or APIs as agent tools, to set up or update Osonai, or mentions the harness or the mapping skill — even if they don't say "manifest" or "tools".
---

# Harness Mapper

Turn an app's codebase into tools a chat agent can call. Each tool does what a user does when they tap
through the app, by calling the same function the app's button calls. The tools run **on the phone, as the
signed-in user**, so they get the app's own auth, validation and screen refresh for free.

## Rules

- **The code stays here.** Read it locally. Never send it anywhere, and never call the app's real services.
- **Never invent.** Every tool traces to a real function you read. If you can't find one, the action goes in
  `gaps`, not in a tool.
- **Write only in `harness/`** while mapping. The one exception: on Android and iOS the bindings file must sit
  in the app's sources to compile (`references/stacks.md` says where). Step 7 (install) changes the app
  itself, and only after the developer approves.
- **Map every user action**, except these, which go in `excluded`: payments, purchases and money movement;
  account deletion; password, login and other auth changes; admin-only functions.
- **The developer's work wins.** On an update, keep what they reviewed (see "Update run").

## Modes

- **First run:** there is no `harness/manifest.json`. Do every step.
- **Update run:** `harness/manifest.json` exists. Follow "Update run" below; never start over.
- **Interactive** (a developer is in the chat): stop after step 6 for approval, then install.
- **CI** (the prompt says CI mode): never ask and never stop. Do steps 1–6, write the review list to the file
  the prompt names, and end. Never install, and change nothing but the harness files.

## Steps

### 1. Detect

Find the app: in a monorepo, the folder of the mobile app (`apps/mobile`, `mobile/`, …). Everything below
happens in that folder; `harness/` goes at its root. Find the stack (React Native, Android or iOS) and read
its section in `references/stacks.md`. Another stack: say the SDK doesn't support it yet and stop.

### 2. Find the user actions, screen by screen

List the app's screens from its navigation. Then, for each screen, take every control the user can use and
follow it inward:

`button / form / gesture` → `handler` → `the function that does the work` (API client, store, mutation, navigation)

For each action write down: the label the user sees, the screen file, the function and its file, and where
each argument comes from (the user types it, the screen holds it, or it is a constant).

Keep these notes in a file **outside the repo** (the system temp folder, for example
`$TMPDIR/osonai-notes.md`). On a big app your memory fills up; the file keeps the list. Delete it at the end.

### 3. Decide the tools

Read `references/rules.md` and apply it to the notes. In short: one tool per thing a user would ask for;
merge actions that differ by a value, split ones that differ in meaning or risk; the model fills only what a
user would say; every ID gets a resolver; read and write tools return only the fields the agent needs.

### 4. Write the files

Read `references/format.md` and write:

| File | What it is |
|---|---|
| `harness/manifest.json` | The tools, and what the app is |
| `harness/bindings.ts` (React Native), `OsonaiTools.kt` / `OsonaiTools.swift` (in the app's sources) | One function per tool, calling the app's own code. No Osonai imports |
| `harness/design.json` | The app's colors and style, from its theme |

Status: `read`, `navigate` and `local` tools are `approved`. `write` and `destructive` tools are
`needs_review`; only the developer approves them.

### 5. Check

```bash
node <skill-dir>/scripts/check.mjs harness/manifest.json --root .
```

Fix every error and run it again until it passes. Then typecheck or compile the bindings with the app's own
tools (`npx tsc --noEmit`, `./gradlew compileDebugKotlin`, `xcodebuild build`). A binding that doesn't
compile means you guessed a name or a signature: read the code again. If the toolchain can't run here, say so.

### 6. Review list

Give the developer this, and nothing longer:

```
Osonai: 23 tools — 14 on, 9 for you to review

Review (write and destructive):
- [ ] add_to_cart — adds a product to the cart · "Add to cart" on ProductScreen
- [ ] remove_from_cart — removes a cart line (asks the user first) · "Remove" on CartScreen

Not mapped:
- Share a list — could not find where the link is made (ListScreen.tsx:88)

Excluded: Checkout (payment), Delete account
```

**Interactive:** ask which to approve. Set those to `approved`, the ones they reject to `rejected`, edit what
they ask, run step 5 again, then go to step 7. **CI:** write the list to the file the prompt names and end.

### 7. Install (interactive, first run, after approval)

Read `references/install.md` and follow it exactly. Show the diff at the end.

## Update run

1. Read `harness/manifest.json`. If the prompt names changed files, look only at the actions those files
   touch; otherwise re-check every tool's binding.
2. **Keep** every tool you did not need to change exactly as it is, `status` included. Never edit a binding
   function marked `// osonai:keep`.
3. **New** actions: add them as new tools (status by kind, as in step 4).
4. **Changed** tools (the bound function's arguments or meaning changed): update them, set `write` and
   `destructive` ones back to `needs_review`.
5. **Broken** tools (the bound function is gone): don't delete them and don't guess. Leave them, and list
   them in the review list under "Broken" with the file and function that vanished.
6. `rejected` tools and `excluded` actions stay as they are; don't map them again.
7. Run step 5. Start the review list with one line: `+N new, ~M changed, K broken`.
