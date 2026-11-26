# How to decide the tools

1. One tool per intent
2. Merge or split
3. Who fills each argument
4. IDs and resolvers
5. Kind, confirmation, status
6. Output allowlist
7. Names and descriptions
8. What to bind to
9. Views
10. Screen context
11. What doesn't become a tool
12. Checklist

## 1. One tool per intent

A tool is something a user would ask for in one sentence: "add these sneakers to my cart", "what's the
status of my last order", "make a folder called TOPIK".

- Several buttons that do the same thing (an "Add" on the product screen, a "+" on the list) are **one** tool.
- One function that does several things (`updateItem(id, { op: "add" | "move" | "remove" })`) is
  **several** tools.
- Never a catch-all tool (`do_action(name, payload)`). The agent may only call what the developer can review.

## 2. Merge or split

**Merge** when actions differ only by a value and mean the same thing:
`setStudyMode("flashcards")`, `setStudyMode("quiz")` → `set_study_mode(mode: "flashcards" | "quiz")`.

**Split** when they differ in meaning or risk, even on the same function:
`updateWord(id, { archived: true })` and `deleteWord(id)` → `archive_word` (write) and `delete_word`
(destructive).

Test: would the user be upset if the agent mixed the two up? Then split.

## 3. Who fills each argument

Every argument of the app function comes from exactly one place:

| From | Manifest field | Example |
|---|---|---|
| what the user says | `params` | product name, quantity, folder name |
| what is on screen now | `bound` (`from: "context.<name>"`) | the open product, the open folder |
| a constant at the call site | `fixed` | `source: "chat"` |

- **Identity is never a param.** The model must not fill `userId`, `accountId`, `token` or anything that
  says who the user is. Usually the app's API client adds the token itself, so the function needs nothing.
  If the function does take a user id, the binding reads it from the app's own auth store.
- A value the screen holds is a default the user may override ("add *this*" vs "add the red ones"):
  `{ "from": "context.current_product_id", "overridable_by": "product_name" }` when the model names it and a
  resolver turns the name into the ID, or `"overridable": true` when the model fills the same argument.
  A param with a bound default is not `required`.
- Keep `params` small. Each one is another chance for a wrong argument.

## 4. IDs and resolvers

The model doesn't know that "TOPIK" is `fld_8f2c`. It never fills an ID.

1. Have a `read` tool that lists the things with an id and a name (`list_folders` → `[{ id, name }]`). The
   app almost always loads this list somewhere; bind to that.
2. Declare a resolver: `"folder": { "tool": "list_folders", "id_field": "id", "name_field": "name" }`.
3. The tool takes the name (`folder_name`) and `resolve` turns it into the ID the function needs
   (`"folder_name": { "resolver": "folder", "to_param": "folderId" }`).

The SDK calls the resolver's read tool **with no arguments**, so its binding must work with none: default to
what the app shows now (the selected group or account), or list everything the user can see.

The SDK does the matching on the phone: one match runs, several show a choice, none asks. Set
`"preload": true` on a resolver's read tool when the list is small and belongs to the user (folders, lists).

## 5. Kind, confirmation, status

| Kind | Means | Confirmation | Status |
|---|---|---|---|
| `read` | gets data, changes nothing | `none` | `approved` |
| `navigate` | opens a screen | `none` | `approved` |
| `local` | only on the phone (speak, copy, share sheet) | `none` | `approved` |
| `write` | creates or changes the user's data | `none` | `needs_review` |
| `destructive` | deletes, or changes in a way that's hard to undo | `confirm` | `needs_review` |

Unsure between `write` and `destructive`? Choose `destructive`. Anything that acts on many items at once
("clear the cart", "reset progress") is `destructive`. A `local` tool that changes saved data (a setting) is
`write`.

## 6. Output allowlist

The function usually returns more than the agent needs, often with personal data. `output_fields` lists
only what the agent needs to answer or to take the next step: usually id, name, a count, a status, a price.
Never tokens, emails, phone numbers or internal flags unless the user's request is about them. Required on
`read` and `write` tools. (A `view` still gets the whole result; see 9.)

## 7. Names and descriptions

**Name:** `verb_object`, snake_case, in the user's words: `add_to_cart`, not `postCartItem` or `handleAdd`.

**Description:** what the model reads to choose the tool. 1–3 sentences: what it does in user terms, when to
use it rather than its nearest neighbour, and what it does *not* do if that's easy to confuse.

```
Good: "Add a product to the user's cart. Use when the user wants to buy or keep a product.
       Does not check out — the user does that in the app."
Bad:  "Calls the cart mutation."
```

**Param description:** the format and an example, from the app's own words: `"Product name as the user says
it, e.g. 'red sneakers'."`

## 8. What to bind to

Best first:

1. **The function the button's handler calls**: a store action, a mutation function, a service method.
   Auth, validation and screen refresh happen exactly as on a tap.
2. **The app's API client method.** If the screen refreshes a cache after calling it, the binding does the
   same refresh.
3. **A navigation call** for `navigate` tools (a navigation ref, the router).
4. **Raw HTTP**: only if nothing else exists. Say so in the review list.

A React hook can't be called outside a component. Bind to what it wraps (the mutation function, the store,
the service). If the logic only exists inside the component, don't copy it: put the action in `gaps`.

## 9. Views

Add a `view` to a tool whose result the user wants to *see*: products, a cart, orders, bookings. The chat
draws it as cards from the whole result, and the model doesn't repeat the items as text. Use the real field
names of the result. Set `open` when the app has a screen for that item, so a tap opens it. Format:
`format.md`.

## 10. Screen context

`context` in the manifest lists what the app tells the chat about the screen: `current_screen`, and the open
item's id and name (`current_product_id`, `current_product_name`). Declare only what bound values or the
agent need. The install step makes the app send them.

## 11. What doesn't become a tool

- `gaps`: an action you found in the UI but couldn't trace to a function, or that only works as a
  multi-screen flow holding its state in the UI. Say why and where.
- `excluded`: payments, purchases, money; account deletion; password, login and auth changes; admin-only.
- An action that needs a permission prompt the first time (camera, microphone) is a tool; mention the
  permission in its description.

## 12. Checklist

The Osonai check (SKILL.md step 5) tests all of this. Go through it yourself only when the check can't be
reached.

**Errors** (the app's chat would refuse to open):

- `manifest_version` is 1; `app.name` is set; `tools` is a list.
- Every tool: a unique snake_case `name` not starting with `osonai_`; a `description`; `kind` is `read`,
  `write`, `destructive`, `navigate` or `local`; `confirmation` is `none`, `undo` or `confirm`; `status` is
  `approved`, `needs_review` or `rejected`; `params` is a JSON Schema object whose `required` names are all
  in `properties`.
- `destructive` tools have `confirmation: "confirm"`.
- `preload` only on `read` tools.
- No param says who the user is or carries a credential: `user_id`, `userId`, `token`, `access_token`,
  `session_id`, `password`, `api_key`, … (the whole name; `author` or `session_name` are fine).
- `bound`: each entry is `{ "from": "context.<name>" }`; `overridable` needs a param of the same name,
  `overridable_by` a param with that name; identity is never overridable; a bound param is not `required`.
- `resolve`: each entry names a param that exists, and is `{ resolver, to_param }` with a known resolver.
- `resolvers`: each has `tool`, `id_field` and `name_field`, and its tool is a `read` tool.
- A `view`'s `type` is `list` or `detail`, it has a `title`, and `layout` is `cards` or `rows`.

**Warnings** (fix them too):

- Names are `verb_object`: `add_to_cart`.
- `read` and `write` tools have a non-empty `output_fields`.
- No param is an ID (`id`, `…_id`, `…Id`) unless `resolve` or `bound` fills it.
- `binding` has `target` and a known `call_type`; `sources` has at least one line.
- Every param has a `type` (or `enum`) and a `description`.
- No `approved` `read`, `navigate` or `local` tool is bound to a function that starts with a verb that
  changes data (`add…`, `set…`, `delete…`, `send…`, …): make it `write`, or leave it `needs_review`.
- Each `excluded` and `gaps` entry has `action` and `reason`.
