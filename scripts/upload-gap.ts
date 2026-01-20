import { config } from 'dotenv';
import { readFileSync } from 'fs';
import { ConvexHttpClient } from 'convex/browser';
import { api } from '../convex/_generated/api';

config({ path: '.env.local' });

async function main() {
  const client = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
  const file = process.argv[2];
  const tf = process.argv[3];
  
  const data = JSON.parse(readFileSync(file, 'utf-8'));
  console.log(`Uploading ${data.length} ${tf} candles...`);

  const candles = data.map((c: any) => ({
    pair: 'DXY', timeframe: tf, timestamp: c.timestamp,
    open: c.open, high: c.high, low: c.low, close: c.close,
    volume: 0, complete: true
  }));

  for (let i = 0; i < candles.length; i += 100) {
    await client.action(api.candles.uploadCandles, { candles: candles.slice(i, i + 100) });
    if ((i + 100) % 5000 === 0) console.log('  Uploaded', i + 100);
  }
  console.log('Done!');
}

main().catch(console.error);
