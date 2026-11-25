---
description: Add the Osonai assistant to this app — map its actions into tools, then add the chat screen
argument-hint: "[app key osk_pub_...]"
---

Use the harness-mapper skill on the app in the current directory, in interactive mode.

- The app key is: $ARGUMENTS
  If that is empty, ask for it once, when you reach the install step. The developer may say "later"; then
  write `osk_pub_REPLACE_ME` and remind them at the end.
- Talk to the developer only at these points: the review list (step 6), and the end. Keep everything else
  quiet: no running commentary, no dumps of JSON or code.
- At the end, say in three lines: what was added, what they must still do (for example `pod install`, the app
  key), and how to open the chat.
- Then offer once to keep the tools in sync on every pull request. If they say yes, copy
  `${CLAUDE_PLUGIN_ROOT}/templates/osonai-harness.yml` to `.github/workflows/osonai-harness.yml` and tell them
  to run `gh secret set ANTHROPIC_API_KEY` (or `CLAUDE_CODE_OAUTH_TOKEN` from `claude setup-token`).

The code never leaves this machine except to your own model provider. Don't call any network service except
the package registry during the install.
