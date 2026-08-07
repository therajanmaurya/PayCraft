# RED canary — dual `PayCraftThemeProvider` defect (pre-Phase-1 state)

Pins the defect the paycraft-clean-sdk-ui-theme-modes epic Phase 1 fixed: TWO
top-level `fun PayCraftThemeProvider` composables shared the same name in two
different packages, silently picking different code paths depending on the
importer.

## Repro command (against a pre-Phase-1 snapshot)

```
grep -rc 'fun PayCraftThemeProvider' cmp-paycraft/src/commonMain
# expected in the RED snapshot: 2
```

## What the RED state looked like

- `cmp-paycraft/src/commonMain/kotlin/com/mobilebytelabs/paycraft/ui/theme/PayCraftTheme.kt`
  → `fun PayCraftThemeProvider(theme: PayCraftTheme = PayCraftTheme.Default, content: @Composable () -> Unit)`
  — host-inheriting (Material3 adaptive) path.
- `cmp-paycraft/src/commonMain/kotlin/com/mobilebytelabs/paycraft/presentation/MobileByteSenseiTheme.kt`
  → `fun PayCraftThemeProvider(themeOverride: Map<String, String> = emptyMap(), useDark: Boolean = false, content: @Composable () -> Unit)`
  — brand-locking path that IGNORED the host `MaterialTheme` and read cloud
    `theme_jsonb` / `primary_color` directly.

Production paywall (`ui/PayCraftPaywall.kt:113,162`) routed through the
brand-locked provider; `ui/PayCraftRestore.kt` imported BOTH — the smoking
gun that both providers were on the live path with divergent semantics.

## Why this must not regress

Two same-named providers in different packages force every callsite to make
an import-order decision that isn't visible at the call site, so a later phase
that touches "the" theme surface will silently pick the wrong `ColorScheme`
depending on which import path a caller happened to reach. The GREEN snapshot
collapses to ONE `fun PayCraftThemeProvider` with an explicit config-wins
precedence, restoring a single decidable answer for downstream Compose tests.

See `../green/README.md` for the fixed state.
