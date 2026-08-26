# PayCraft Sample

A minimal, copy-pasteable sample showing the **two ways** to integrate the PayCraft
SDK into a Kotlin Multiplatform (Compose) app. It targets the **"PayCraft Sample"**
tenant that lives under the `mobilebytesensei@gmail.com` account — grab its
`pk_test_…` key from the dashboard (**PayCraft Sample → Settings → API keys**) and
drop it into `PayCraft.initialize(...)`.

```kotlin
implementation("io.github.mobilebytelabs:cmp-paycraft:LATEST")
```

## What's here

- [`SampleApp.kt`](SampleApp.kt) — one file, both integration modes side by side:
  - **Mode 1 — drop-in paywall** (`PayCraftPaywall`), themed to the host app.
  - **Mode 2 — headless** (`PayCraft.billingManager` + `PayCraft.checkout`), your own UI.

Everything else — products, prices, trials, discounts, checkout routing (Google
Play / App Store / Stripe / Razorpay), restore — comes from the dashboard and
updates in **realtime** (change a price or trial in the dashboard and this app
reflects it without a rebuild).

## Run

1. Copy the `PayCraft Sample` test key into `SampleApp.kt`.
2. Wire `SampleApp()` into any KMP Compose target's root composable.
3. Toggle between the two modes with the switch at the top.

Full guide: <https://paycraft.mobilebytesensei.com/docs/sdk-integration>
