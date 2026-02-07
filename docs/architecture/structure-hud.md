# Structure HUD — "Where Are We" Chart Overlay

> Added: 2026-02-07

## Purpose

The Structure HUD is a compact overlay positioned at the top-right of the chart that provides an at-a-glance summary of the current market structure state. It eliminates the need to switch to the sidebar's Structure Panel for the most critical structural context while trading.

## Design Rationale

### Hybrid Timeframe Behavior

The HUD uses a hybrid approach — some rows adapt to the selected chart timeframe, while others remain universal:

| Row | Label | Changes with TF? | Why |
|-----|-------|:-:|-----|
| 1 | **Trend** | Yes | Shows the trend on the chart you're reading |
| 2 | **MTF** | No | Already a composite across all timeframes |
| 3 | **P/D** | No | Shows H4/D1/W1 zones — structural, not chart-dependent |
| 4 | **BOS** | Yes | Most recent BOS on the timeframe you're actively reading |
| 5 | **Above** | No | Key levels (PDH/PWH etc.) are the same regardless of chart TF |
| 6 | **Below** | No | Same as above |
| 7 | **FVGs** | Yes | Active gaps on the current timeframe |

When you flip from H4 to D1, the Trend/BOS/FVGs rows update, but MTF and key levels stay anchored to the bigger picture.

## Row Details

### Row 1: Trend + Swing Sequence
- **Source**: `currentStructure.direction` + last 3 entries from `swingSequence`
- **Display**: Direction arrow + word (e.g. "Bullish") + colored swing label pills (HH, HL, etc.)
- Colors: green = bullish labels, red = bearish labels, yellow = equal (EQH/EQL)

### Row 2: MTF Score
- **Source**: `mtfScore.composite` (-100 to +100)
- **Display**: Mini progress bar + numeric score
- Color: green (> +30), red (< -30), yellow (mixed)

### Row 3: Premium/Discount
- **Source**: `premiumDiscount.h4Zone`, `d1Zone`, `w1Zone`
- **Display**: Three small badges — "H4 P", "D1 D", "W1 P"
- Colors: red = premium, green = discount

### Row 4: Last BOS
- **Source**: `currentStructure.lastBOS`
- **Display**: Direction arrow + broken level price + time ago

### Rows 5 & 6: Nearest Key Levels
- **Source**: `keyLevelEntries` filtered against `currentPrice`
- **Display**: Level label (e.g. "PWH") + price + pip distance
- Nearest above and nearest below current price

### Row 7: Active FVGs
- **Source**: `fvgEvents` filtered to `status === "fresh" || "partial"`
- **Display**: Count by direction — "3 bull / 2 bear"

## Data Flow

```
useStructure({ pair, timeframe })
    |
    v
structureData: StructureResponse   +   livePrice?.mid (from useOandaStream)
    |                                        |
    v                                        v
page.tsx passes both as props to StructureHUD
    |
    v
StructureHUD computes 7 useMemo values → renders 7 rows
```

No additional API calls. All data comes from the existing `StructureResponse` payload and the OANDA live price stream.

## Toggle Persistence

The HUD visibility is toggled via a "HUD" button in the sidebar's Structure section, following the same pattern as Swings/BOS/Levels/FVGs/P&D toggles.

Persistence flow:
1. User clicks "HUD" toggle in ChartSidebar
2. `onShowStructureHUDChange` fires in page.tsx
3. Local state updates + `persistStructurePrefs({ hud: value })` saves to Convex
4. On next page load, `useStructurePrefs` reads the saved value and seeds local state

The `hud` field uses `v.optional(v.boolean())` in the Convex schema for backward compatibility with existing preference records.

## Positioning

The HUD sits inside a flex-column container at `absolute top-4 right-4 z-30` alongside `LivePositionsContainer`. When live positions exist, they stack above the HUD. When no positions are open, the HUD moves to the top of the chart area.

## Files

| File | Role |
|------|------|
| `src/components/chart/StructureHUD.tsx` | The overlay component |
| `src/app/chart/[pair]/page.tsx` | Renders HUD, manages toggle state |
| `src/components/chart/ChartSidebar.tsx` | Toggle button |
| `src/components/chart/LivePositionPanel.tsx` | Accepts `className` prop for flex stacking |
| `convex/schema.ts` | `hud` field in `overlayToggles` |
| `convex/structurePrefs.ts` | `hud` in upsert args |
| `src/hooks/useStructurePrefs.ts` | `hud` in `OverlayToggles` interface |
