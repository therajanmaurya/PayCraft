# GREEN canary — single unified `PayCraftThemeProvider` (post-Phase-1 state)

Pins the fix the paycraft-clean-sdk-ui-theme-modes epic Phase 1 landed: EXACTLY
one `fun PayCraftThemeProvider` composable across `cmp-paycraft/src/commonMain`,
with an explicit **config-wins-else-host-inherit** precedence rule.

## Repro command

```
grep -rc 'fun PayCraftThemeProvider' cmp-paycraft/src/commonMain
# expected in the GREEN snapshot: 1
```

## What the GREEN state looks like

- Sole declaration:
  `cmp-paycraft/src/commonMain/kotlin/com/mobilebytelabs/paycraft/ui/theme/PayCraftTheme.kt`
  → `fun PayCraftThemeProvider(theme: PayCraftTheme = PayCraftTheme.Default, config: SuiteConfig? = null, content: @Composable () -> Unit)`
- `presentation/MobileByteSenseiTheme.kt` **deleted**; its brand palette
  (`colorsLight` / `colorsDark`) is folded into
  `ui/theme/PayCraftColors.kt` as `PayCraftBrandColorsLight` /
  `PayCraftBrandColorsDark`, and its `parseHexColor` + `applyThemeOverride`
  helpers folded into `BrandedPalette` in the same file.
- `SuiteConfig.themeOverride: BrandedPalette?` is the sole normalized cloud
  theme accessor the provider consumes.

## Precedence contract (locked by `PayCraftThemeTest.kt`)

- **AC-2 (host-inherit)** — with `config = null`, the resolved
  `MaterialTheme.colorScheme.primary` inside `PayCraftThemeProvider` equals the
  host `MaterialTheme.colorScheme.primary` verbatim.
- **AC-3 (config-wins)** — with `config.paywall.primaryColor = "#00AA55"`, the
  resolved `MaterialTheme.colorScheme.primary` equals `Color(0xFF00AA55)`
  regardless of the (contrasting) host `MaterialTheme.colorScheme.primary`.

## Callsite migration accomplished

Every importer of either former provider now routes through
`ui.theme.PayCraftThemeProvider(config = liveConfig)`:

- `ui/PayCraftPaywall.kt` (both `PayCraftPaywall` + `PayCraftPaywallSheet`)
- `ui/PayCraftPaywallComposable.kt`
- `ui/PayCraftRestore.kt` (dropped the second import)

The deprecated `Minimal`/`Premium`/`Dark` templates now consume
`PayCraftBrandColorsLight`/`Dark` directly.

See `../red/README.md` for the pre-fix state.
