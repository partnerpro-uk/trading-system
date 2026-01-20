#!/bin/bash
# Overnight Backfill Script
# Runs all backfill tasks in sequence

set -e
cd "$(dirname "$0")/.."

echo "=== OVERNIGHT BACKFILL STARTED ==="
echo "Start time: $(date)"
echo ""

# Step 1: Backfill OANDA candle windows (large batch for overnight)
echo "=== STEP 1: Fetching OANDA 1-minute candle windows ==="
echo "This will take several hours for ~18k events..."
npx tsx scripts/backfill-event-windows.ts --limit 20000 2>&1 | tee -a logs/overnight-windows.log

echo ""
echo "=== STEP 2: Calculating price reactions ==="
npx tsx scripts/calculate-all-reactions.ts 2>&1 | tee -a logs/overnight-reactions.log

echo ""
echo "=== STEP 3: Regenerating statistics ==="
npx tsx scripts/regenerate-statistics.ts 2>&1 | tee -a logs/overnight-stats.log

echo ""
echo "=== OVERNIGHT BACKFILL COMPLETE ==="
echo "End time: $(date)"
