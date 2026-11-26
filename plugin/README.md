# Osonai for Claude Code

Add an AI assistant to your mobile app that does what your users ask: "add these sneakers to my cart", "where
is my order", "remind me when Timur gets to school". The assistant acts through your app's own functions, as
the signed-in user, so it gets your auth, validation and screen updates for free.

This plugin does the setup for you. It reads your app on your machine, turns each user action into a tool,
asks you to approve the ones that change data, and adds the chat screen.

Supported apps: React Native (and Expo), Android (Kotlin) and iOS (Swift).

## Use it

In your app's repository:

```
/plugin marketplace add zohidjon-m/osonai
/plugin install osonai@osonai
/osonai:setup osk_pub_...
```

`osk_pub_…` is your app key from the Osonai team. You can leave it out and add it later.

## What it does, step by step

1. **Reads your app's code** to find its screens, buttons and forms, and the functions they call.
2. **Writes `harness/`** in your app:
   - `harness/manifest.json`: one tool per user action, with what it does, its arguments, and how risky it is;
   - `harness/bindings.ts` (React Native), or `OsonaiTools.kt` / `OsonaiTools.swift` in your app's sources:
     one short function per tool, calling your app's own code;
   - `harness/design.json`: your app's colors, so the chat matches it.
3. **Checks the result**: sends `harness/manifest.json` to the Osonai check (`https://sdk.oson.ai/v1/osonai/manifest/check`),
   which applies the same rules the Osonai server applies when your app's chat opens, then runs your own
   typecheck or build.
4. **Shows you a review list.** Tools that only read data are switched on. Tools that change or delete data
   stay off until you approve them. Payments, purchases, account deletion and login or password changes are
   never mapped.
5. **Installs the chat, only after you approve:** adds the Osonai SDK to your dependencies, a config file with
   the server address and your app key, one chat screen, and one button or route to open it.
6. **Offers a GitHub workflow** (`templates/osonai-harness.yml`) that keeps `harness/` up to date on each pull
   request. It is copied only if you say yes.

## What it reads, writes, runs and sends

| | |
|---|---|
| Reads | your repository, on your machine |
| Writes | `harness/`; the tools file in your app's sources (Android, iOS); and, after you approve the install, your dependency file, one config file, one chat screen and the place you open it from. Mapping notes go to a temporary file outside the repository and are deleted at the end |
| Runs | one HTTPS request to the Osonai manifest check; your own typecheck or build (TypeScript, Gradle or Xcode); during the install, your own package manager adds `@osonai/react-native` and `react-native-webview` (npm, CocoaPods) or the Gradle dependency from JitPack |
| Network | the Osonai manifest check, which gets only `harness/manifest.json` (tool names, descriptions, the names and files of the functions they call; no source code), keeps nothing and needs no key; and your package registry during the install. Your code goes nowhere else: Claude Code reads it with the model account you already use |
| Doesn't | call your app's backend, commit or push, or change files outside the list above |

Claude Code asks you before each file change and command, as it always does.

## After the install: what the chat sends

The chat screen it adds talks to the Osonai server (`https://sdk.oson.ai`). When a user chats, the server gets
their messages, the screen they are on (as listed in `harness/manifest.json` under `context`), and the results
of the tools the assistant runs, limited to the fields listed in each tool's `output_fields`. The server sends
these to the language model provider it uses (currently DeepSeek) to write the replies.

- A conversation ends after 24 hours without use.
- A trace of each turn, including the message text (with secrets such as tokens removed), is kept for 30 days
  to find problems.
- The tools run on the phone with the user's own login; the server never gets your backend credentials.
- Tools that delete data always ask the user on the phone first.

The full privacy policy: https://github.com/zohidjon-m/osonai/blob/main/PRIVACY.md

## More

- The SDKs, the GitHub Action and the full docs: https://github.com/zohidjon-m/osonai
- Questions and problems: https://github.com/zohidjon-m/osonai/issues

## License

MIT
