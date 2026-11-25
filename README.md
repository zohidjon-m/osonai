# Osonai

An AI assistant inside your mobile app that does what your users ask: search, add to cart, check an order,
open a screen. It acts through your app's own functions, as the signed-in user, so it gets your auth,
validation and screen updates for free.

## Set it up

In your app's repository, with [Claude Code](https://claude.com/claude-code):

```
/plugin marketplace add zohidjon-m/osonai
/plugin install osonai@osonai
/osonai:setup osk_pub_...
```

`/osonai:setup` reads your app on your machine, turns each user action into a tool (`harness/`), asks you to
approve the ones that change data, and adds the chat screen. Your code never leaves your machine except to your
own model provider.

Get your app key (`osk_pub_…`) from the Osonai team.

## Keep it in sync

Copy [`plugin/templates/osonai-harness.yml`](plugin/templates/osonai-harness.yml) to `.github/workflows/` and add the secret
`ANTHROPIC_API_KEY` (or `CLAUDE_CODE_OAUTH_TOKEN`). On every pull request it updates `harness/` for the code that
changed and posts one review comment.

## Packages

| Platform | Install | Docs |
|---|---|---|
| React Native | `npm install @osonai/react-native react-native-webview` | [packages/react-native](packages/react-native) |
| Android | JitPack: `com.github.zohidjon-m:osonai:0.1.0` | [packages/android](packages/android) |
| iOS | Swift package `https://github.com/zohidjon-m/osonai` | [packages/ios](packages/ios) |

The bridge between the app and the chat page: [docs/mobile.md](docs/mobile.md). The mapping skill:
[plugin/skills/harness-mapper](plugin/skills/harness-mapper).

## Privacy

What the plugin and the assistant handle: [PRIVACY.md](PRIVACY.md).

## License

MIT
