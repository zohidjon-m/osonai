# Osonai privacy policy

_Last updated: 25 November 2026_

Osonai makes an in-app AI assistant for mobile apps: a Claude Code plugin that sets it up, phone SDKs, and a
server at `https://sdk.oson.ai` that runs the assistant. This page says what data each part handles.

## The Claude Code plugin

The plugin collects nothing. It runs in the developer's own Claude Code and reads their code on their machine.
Their code goes only to the model provider they already use with Claude Code, under that provider's terms. It
never reaches Osonai.

## The assistant in an app (the SDK and the Osonai server)

When someone uses the assistant inside an app, the Osonai server receives:

- the messages they type;
- what is on their screen, limited to the fields the app's developer lists (for example the open product);
- the results of the actions the assistant runs for them, limited to the fields the developer allows;
- an anonymous ID the server gives each app install (`usr_…`), which is not linked to a name, email or phone
  number;
- the app's key, and technical data every web request carries, such as the IP address.

The actions themselves run on the phone, with the user's own login in the app. The Osonai server never receives
the app's passwords, login tokens or backend credentials.

### How we use it

- To write the assistant's replies.
- To enforce each app's usage limits and count usage per app.
- To find and fix problems.

We don't sell this data, use it for ads, or use it to train models.

### Who else receives it

- **The language model provider** that writes the replies, currently DeepSeek. It receives the messages, screen
  fields and action results of a conversation, and processes them under its own API terms.
- **Our hosting providers**, which run the server and carry its traffic (a cloud server behind Cloudflare).

We change providers only to keep the service working, and we update this page when we do.

### How long we keep it

| Data | Kept for |
|---|---|
| A conversation (messages, screen fields, action results) | 24 hours after its last message |
| Traces of each turn (message text and action results, with secrets such as tokens removed) | 30 days |
| Anonymous install IDs and daily usage counts per app | while the app uses Osonai |

## App developers

An app that adds the assistant decides what its users can do with it. The developer should tell their users in
their own privacy policy that the assistant sends their messages to Osonai and its model provider.

## Children

Osonai is a tool for app developers and is not directed at children.

## Your choices

To ask what we hold about an app or an install ID, or to have it deleted, contact us (below). We answer within 30 days.

## Changes

We update this page when how we handle data changes, and change the date at the top.

## Contact

Open an issue at https://github.com/zohidjon-m/osonai/issues. Don't put personal data in the issue: say what
you need, and we reply with a private way to send the details.
