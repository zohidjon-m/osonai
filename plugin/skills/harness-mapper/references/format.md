# File formats

1. `harness/manifest.json`
2. Bindings (one function per tool)
3. `harness/design.json`

## 1. harness/manifest.json

A shop app, three tools:

```json
{
  "manifest_version": 1,
  "app": {
    "name": "Bozor",
    "description": "an online shop: products, a cart, a wishlist and order tracking",
    "agent_instructions": [
      "Prices are in US dollars. Write them with a dollar sign, for example $79.99.",
      "Checkout and payment happen only in the app. Never say an order was placed or paid."
    ]
  },
  "context": [
    { "name": "current_screen", "description": "Screen open in the app: home, product, cart or orders." },
    { "name": "current_product_id", "description": "ID of the product open on screen, if any." },
    { "name": "current_product_name", "description": "Name of the product open on screen, if any." }
  ],
  "resolvers": {
    "product": { "tool": "search_products", "id_field": "id", "name_field": "name" }
  },
  "tools": [
    {
      "name": "search_products",
      "description": "Search the shop's products by words, category or highest price. Returns matching products with price and stock. With no filters it lists every product.",
      "kind": "read",
      "confirmation": "none",
      "params": {
        "type": "object",
        "properties": {
          "query": { "type": "string", "description": "Words in the product name, e.g. 'red sneakers'." },
          "category": { "type": "string", "enum": ["shoes", "clothing", "home"], "description": "Product category." },
          "max_price": { "type": "number", "description": "Highest price in US dollars, e.g. 50." }
        },
        "required": []
      },
      "bound": {},
      "fixed": {},
      "resolve": {},
      "output_fields": ["id", "name", "price", "currency", "stock"],
      "binding": { "target": "api.searchProducts", "file": "src/api.ts", "call_type": "api_client" },
      "sources": ["src/screens/HomeScreen.tsx — search box"],
      "view": { "type": "list", "layout": "cards", "image": "image", "title": "name", "value": "price", "open": "product" },
      "status": "approved"
    },
    {
      "name": "add_to_cart",
      "description": "Add a product to the user's cart. Use when the user wants to buy or keep a product. Does not check out.",
      "kind": "write",
      "confirmation": "none",
      "params": {
        "type": "object",
        "properties": {
          "product_name": { "type": "string", "description": "Product as the user names it, e.g. 'black hoodie'. Defaults to the product open on screen." },
          "quantity": { "type": "integer", "minimum": 1, "description": "How many, e.g. 2. Default 1." }
        },
        "required": []
      },
      "bound": { "productId": { "from": "context.current_product_id", "overridable_by": "product_name" } },
      "fixed": {},
      "resolve": { "product_name": { "resolver": "product", "to_param": "productId" } },
      "output_fields": ["productId", "quantity", "itemCount"],
      "binding": { "target": "api.addToCart", "file": "src/api.ts", "call_type": "api_client" },
      "sources": ["src/screens/ProductScreen.tsx — \"Add to cart\""],
      "status": "needs_review"
    },
    {
      "name": "remove_from_cart",
      "description": "Remove a product from the user's cart. Use when the user no longer wants it.",
      "kind": "destructive",
      "confirmation": "confirm",
      "params": {
        "type": "object",
        "properties": { "product_name": { "type": "string", "description": "Product in the cart, e.g. 'black hoodie'." } },
        "required": ["product_name"]
      },
      "bound": {},
      "fixed": {},
      "resolve": { "product_name": { "resolver": "product", "to_param": "productId" } },
      "output_fields": ["itemCount"],
      "binding": { "target": "api.removeFromCart", "file": "src/api.ts", "call_type": "api_client" },
      "sources": ["src/screens/CartScreen.tsx — \"Remove\""],
      "status": "needs_review"
    }
  ],
  "excluded": [
    { "action": "Check out and pay", "reason": "payment", "source": "src/screens/CheckoutScreen.tsx" }
  ],
  "gaps": [
    { "action": "Share a product", "reason": "the share link is made in native code I could not trace", "source": "src/screens/ProductScreen.tsx:88" }
  ]
}
```

### Fields

| Field | Notes |
|---|---|
| `app.name`, `app.description` | The app's name and one line on what it is |
| `app.agent_instructions` | Short rules the agent must follow in this app: currency, what it can't do, ID formats. Only facts you found in the code |
| `context` | What the app tells the chat about the screen (`rules.md` §10) |
| `resolvers` | name → `{ tool, id_field, name_field }`; the tool is a `read` tool |
| `name` | `verb_object`, snake_case, unique; never starts with `osonai_` |
| `description` | 1–3 sentences in user terms |
| `kind` | `read` · `write` · `destructive` · `navigate` · `local` |
| `confirmation` | `none`, or `confirm` (always for `destructive`) |
| `preload` | `true` only on a small, user-owned `read` list a resolver uses |
| `params` | JSON Schema object: only what the user says. Every property has a `type` (or `enum`) and a `description` |
| `bound` | keyed by the function's argument name: `{ "from": "context.<name>" }`, plus `overridable` or `overridable_by` for a default the user may replace |
| `fixed` | constants at the call site |
| `resolve` | name param → `{ resolver, to_param }` |
| `output_fields` | allowlist; required on `read` and `write` |
| `binding` | `target`: the exact function (`api.addToCart`); `file`: where it is defined; `call_type`: `api_client` · `store_action` · `mutation` · `navigation` · `local` · `raw_http` |
| `sources` | one short line per UI entry point: `"<screen file> — <label the user sees>"` |
| `view` | optional; see below |
| `status` | `approved` · `needs_review` · `rejected` (`rules.md` §5) |
| `notes` | optional; one line for the reviewer, e.g. why two buttons were merged |
| `excluded`, `gaps` | `{ action, reason, source }` |

### What the binding function gets

The SDK builds the arguments before it calls the function:

- `fixed` values, under their keys;
- each resolved name as its `to_param` (`productId`), not the name;
- `bound` values, under their keys, unless the user overrode them;
- the other params, under their own names.

So a function bound to `api.addToCart(productId, quantity)` gets `{ productId, quantity }`.

### View

How the chat shows a result as cards. The chat reads the whole result (not only `output_fields`); the
model never sees the view. A field is a path into the item (`name`, `price`) or a template with paths in
braces (`"Order {id}"`, `"{quantity} × {unitPrice:money}"`). Use only fields the real result has.

| Key | Notes |
|---|---|
| `type` | `list` or `detail` |
| `items` | list: path to the array; leave it out when the result is the array |
| `layout` | list: `cards` (pictures, scroll sideways; things to choose from) or `rows` (default; cart, orders, history) |
| `image` | path to a picture URL |
| `title` (required), `subtitle`, `badge` | text; a badge with a state word (delivered, failed) gets a color |
| `value` | an amount; shows as money when the item or result has `currency` |
| `facts` | detail: `{ "Label": "field" }` |
| `list` | detail: a list view under the facts |
| `total` | list: an amount for the whole result |
| `open`, `id` | a tap asks the app to open its screen of kind `open` for the item's `id` (default field `id`) |

## 2. Bindings

One thin function per tool name. It calls the app's own function and returns its result. No retries, no
confirmation, no output filtering: the SDK does those from the manifest. A thrown error goes to the model,
so write its message for the model ("No product is open on screen. Ask the user which product.").

**No Osonai imports**, so the file compiles before the SDK is installed. Put a comment with the source
screen above each function.

### React Native — `harness/bindings.ts`

```ts
// Osonai tools: one function per tool in harness/manifest.json.
import { api } from '../src/api';
import { navigationRef } from '../src/navigation';

type Tool = (args: Record<string, any>) => unknown;

export const tools: Record<string, Tool> = {
  // HomeScreen: search box
  search_products: (args) => api.searchProducts(args),
  // ProductScreen: "Add to cart"
  add_to_cart: async ({ productId, quantity }) => {
    if (!productId) throw new Error('No product given and none is open. Ask the user which product.');
    return api.addToCart(productId, quantity ?? 1);
  },
  // CartScreen: "Remove"
  remove_from_cart: ({ productId }) => api.removeFromCart(productId),
  // Tab bar: "Orders"
  open_orders: () => {
    navigationRef.navigate('Orders');
    return { opened: true };
  },
};
```

### Android — `OsonaiTools.kt` (in the app's sources)

```kotlin
// Osonai tools: one function per tool in harness/manifest.json.
package com.example.shop.osonai

import org.json.JSONObject
import com.example.shop.data.ShopRepository

class OsonaiTools(private val repo: ShopRepository) {
    val all: Map<String, suspend (JSONObject) -> Any?> = mapOf(
        // ProductScreen: "Add to cart"
        "add_to_cart" to { args ->
            val id = args.optString("productId").ifEmpty { error("No product given. Ask the user which product.") }
            repo.addToCart(id, args.optInt("quantity", 1))
        },
    )
}
```

### iOS — `OsonaiTools.swift` (in the app's sources)

```swift
// Osonai tools: one function per tool in harness/manifest.json.
import Foundation

enum OsonaiTools {
    static func all(api: ShopAPI) -> [String: @Sendable ([String: Any]) async throws -> Any?] {
        [
            // ProductView: "Add to cart"
            "add_to_cart": { args in
                guard let id = args["productId"] as? String else { throw ToolError("No product given. Ask the user which product.") }
                return try await api.addToCart(id, quantity: args["quantity"] as? Int ?? 1)
            },
        ]
    }
}

struct ToolError: LocalizedError { let errorDescription: String?; init(_ m: String) { errorDescription = m } }
```

Return values must be JSON-like: objects, arrays, strings, numbers, booleans. On Kotlin and Swift, turn the
app's model objects into maps (or `JSONObject`) with the fields the manifest needs.

## 3. harness/design.json

The app's look, so the chat's cards match it. Take the values from the app's theme (colors file,
`colors.xml`, asset catalog). Leave out what you can't find.

```json
{
  "colors": { "primary": "#007AFF", "background": "#FFFFFF", "text": "#11181C" },
  "dark": { "primary": "#0A84FF", "background": "#1C1C1E", "text": "#ECEDEE" },
  "font": "Inter",
  "style": "clean iOS look: rounded cards, system font, blue accents"
}
```

`style` is one line on the overall feel, in words a designer would use.
