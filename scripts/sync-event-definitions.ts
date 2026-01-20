#!/usr/bin/env npx tsx
/**
 * Sync event definitions from JSON files to Timescale
 *
 * Source of truth: data/event_definitions/*.json
 * Target: Timescale event_definitions and speaker_definitions tables
 *
 * Usage: npx tsx scripts/sync-event-definitions.ts
 */

import { config } from "dotenv";
import pg from "pg";
import { readFileSync } from "fs";
import { join } from "path";

config({ path: ".env.local" });

const { Client } = pg;

interface EconomicEvent {
  event_name: string;
  aliases: string[];
  category: string;
  short_description: string;
  detailed_description: string;
  measures: string;
  release_frequency: string;
  typical_release_time: string;
  source_authority: string;
  country: string;
  primary_currency: string;
  secondary_currencies: string[];
  typical_impact: string;
  beat_interpretation: object;
  miss_interpretation: object;
  global_spillover: string;
  spillover_description: string;
  revision_tendency: string;
  related_events: string[];
  historical_context: string;
  trading_notes: string;
}

interface Speaker {
  event_name: string;
  category: string;
  speaker: object;
  typical_impact: string;
  what_to_watch: string;
  market_sensitivity: string;
  regime_change_potential: string;
  regime_change_examples: string;
  primary_currency: string;
  related_events: string[];
}

interface GeopoliticalEvent {
  event_id: string;
  event_name: string;
  aliases: string[];
  category: string;
  status: string;
  dates: {
    start_date: string;
    end_date: string | null;
    peak_crisis_date: string | null;
  };
  rumor_period: object | null;
  phases: object[];
  pair_impacts: object;
  macro_backdrop: object;
  short_description: string;
  detailed_description: string;
  trading_notes: string;
  global_spillover: string;
  lessons_learned?: string[];
}

async function main() {
  const client = new Client({
    connectionString: process.env.TIMESCALE_URL,
    ssl: { rejectUnauthorized: false },
  });

  console.log("🔄 Syncing event definitions to Timescale...\n");

  await client.connect();
  console.log("✓ Connected to Timescale\n");

  // Load JSON files
  const basePath = join(process.cwd(), "data", "event_definitions");

  const eventsData = JSON.parse(
    readFileSync(join(basePath, "economic_events.json"), "utf-8")
  );
  const speakersData = JSON.parse(
    readFileSync(join(basePath, "speakers.json"), "utf-8")
  );
  const geopoliticalData = JSON.parse(
    readFileSync(join(basePath, "geopolitical_events.json"), "utf-8")
  );

  const events: EconomicEvent[] = eventsData.economic_events;
  const speakers: Speaker[] = speakersData.speakers;
  const geopoliticalEvents: GeopoliticalEvent[] = geopoliticalData.geopolitical_events;

  console.log(`📊 Loaded ${events.length} economic events`);
  console.log(`🎤 Loaded ${speakers.length} speaker definitions`);
  console.log(`🌍 Loaded ${geopoliticalEvents.length} geopolitical events\n`);

  // Create tables if they don't exist
  console.log("Ensuring tables exist...");

  await client.query(`
    CREATE TABLE IF NOT EXISTS event_definitions (
      event_name VARCHAR(255) PRIMARY KEY,
      aliases TEXT[] DEFAULT '{}',
      category VARCHAR(50),
      short_description TEXT,
      detailed_description TEXT,
      measures TEXT,
      release_frequency VARCHAR(50),
      typical_release_time VARCHAR(100),
      source_authority VARCHAR(255),
      country VARCHAR(10),
      primary_currency VARCHAR(5),
      secondary_currencies TEXT[] DEFAULT '{}',
      typical_impact VARCHAR(20),
      beat_interpretation JSONB,
      miss_interpretation JSONB,
      global_spillover VARCHAR(20),
      spillover_description TEXT,
      revision_tendency TEXT,
      related_events TEXT[] DEFAULT '{}',
      historical_context TEXT,
      trading_notes TEXT,
      synced_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS speaker_definitions (
      event_name VARCHAR(255) PRIMARY KEY,
      category VARCHAR(50),
      speaker JSONB NOT NULL,
      typical_impact VARCHAR(20),
      what_to_watch TEXT,
      market_sensitivity TEXT,
      regime_change_potential VARCHAR(20),
      regime_change_examples TEXT,
      primary_currency VARCHAR(5),
      related_events TEXT[] DEFAULT '{}',
      synced_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS geopolitical_events (
      event_id VARCHAR(100) PRIMARY KEY,
      event_name VARCHAR(255) NOT NULL,
      aliases TEXT[] DEFAULT '{}',
      category VARCHAR(50) NOT NULL,
      status VARCHAR(20) NOT NULL,
      start_date DATE NOT NULL,
      end_date DATE,
      peak_crisis_date DATE,
      dates JSONB,
      rumor_period JSONB,
      phases JSONB NOT NULL,
      pair_impacts JSONB NOT NULL,
      macro_backdrop JSONB,
      lessons_learned JSONB,
      short_description TEXT,
      detailed_description TEXT,
      trading_notes TEXT,
      global_spillover VARCHAR(20),
      synced_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  console.log("✓ Tables ready\n");

  // Sync economic events
  console.log("Syncing economic events...");
  let eventCount = 0;

  for (const event of events) {
    await client.query(
      `
      INSERT INTO event_definitions (
        event_name, aliases, category, short_description, detailed_description,
        measures, release_frequency, typical_release_time, source_authority,
        country, primary_currency, secondary_currencies, typical_impact,
        beat_interpretation, miss_interpretation, global_spillover,
        spillover_description, revision_tendency, related_events,
        historical_context, trading_notes, synced_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, NOW())
      ON CONFLICT (event_name) DO UPDATE SET
        aliases = EXCLUDED.aliases,
        category = EXCLUDED.category,
        short_description = EXCLUDED.short_description,
        detailed_description = EXCLUDED.detailed_description,
        measures = EXCLUDED.measures,
        release_frequency = EXCLUDED.release_frequency,
        typical_release_time = EXCLUDED.typical_release_time,
        source_authority = EXCLUDED.source_authority,
        country = EXCLUDED.country,
        primary_currency = EXCLUDED.primary_currency,
        secondary_currencies = EXCLUDED.secondary_currencies,
        typical_impact = EXCLUDED.typical_impact,
        beat_interpretation = EXCLUDED.beat_interpretation,
        miss_interpretation = EXCLUDED.miss_interpretation,
        global_spillover = EXCLUDED.global_spillover,
        spillover_description = EXCLUDED.spillover_description,
        revision_tendency = EXCLUDED.revision_tendency,
        related_events = EXCLUDED.related_events,
        historical_context = EXCLUDED.historical_context,
        trading_notes = EXCLUDED.trading_notes,
        synced_at = NOW()
      `,
      [
        event.event_name,
        event.aliases || [],
        event.category,
        event.short_description,
        event.detailed_description,
        event.measures,
        event.release_frequency,
        event.typical_release_time,
        event.source_authority,
        event.country,
        event.primary_currency,
        event.secondary_currencies || [],
        event.typical_impact,
        JSON.stringify(event.beat_interpretation),
        JSON.stringify(event.miss_interpretation),
        event.global_spillover,
        event.spillover_description,
        event.revision_tendency,
        event.related_events || [],
        event.historical_context,
        event.trading_notes,
      ]
    );
    eventCount++;

    if (eventCount % 100 === 0) {
      process.stdout.write(`  ${eventCount}/${events.length}\r`);
    }
  }
  console.log(`✓ Synced ${eventCount} economic events\n`);

  // Sync speaker definitions
  console.log("Syncing speaker definitions...");
  let speakerCount = 0;

  for (const speaker of speakers) {
    await client.query(
      `
      INSERT INTO speaker_definitions (
        event_name, category, speaker, typical_impact, what_to_watch,
        market_sensitivity, regime_change_potential, regime_change_examples,
        primary_currency, related_events, synced_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
      ON CONFLICT (event_name) DO UPDATE SET
        category = EXCLUDED.category,
        speaker = EXCLUDED.speaker,
        typical_impact = EXCLUDED.typical_impact,
        what_to_watch = EXCLUDED.what_to_watch,
        market_sensitivity = EXCLUDED.market_sensitivity,
        regime_change_potential = EXCLUDED.regime_change_potential,
        regime_change_examples = EXCLUDED.regime_change_examples,
        primary_currency = EXCLUDED.primary_currency,
        related_events = EXCLUDED.related_events,
        synced_at = NOW()
      `,
      [
        speaker.event_name,
        speaker.category,
        JSON.stringify(speaker.speaker),
        speaker.typical_impact,
        speaker.what_to_watch,
        speaker.market_sensitivity,
        speaker.regime_change_potential,
        speaker.regime_change_examples,
        speaker.primary_currency,
        speaker.related_events || [],
      ]
    );
    speakerCount++;

    if (speakerCount % 50 === 0) {
      process.stdout.write(`  ${speakerCount}/${speakers.length}\r`);
    }
  }
  console.log(`✓ Synced ${speakerCount} speaker definitions\n`);

  // Sync geopolitical events
  console.log("Syncing geopolitical events...");
  let geoCount = 0;

  for (const geo of geopoliticalEvents) {
    await client.query(
      `
      INSERT INTO geopolitical_events (
        event_id, event_name, aliases, category, status,
        start_date, end_date, peak_crisis_date,
        dates, rumor_period, phases, pair_impacts, macro_backdrop,
        lessons_learned, short_description, detailed_description,
        trading_notes, global_spillover, synced_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, NOW())
      ON CONFLICT (event_id) DO UPDATE SET
        event_name = EXCLUDED.event_name,
        aliases = EXCLUDED.aliases,
        category = EXCLUDED.category,
        status = EXCLUDED.status,
        start_date = EXCLUDED.start_date,
        end_date = EXCLUDED.end_date,
        peak_crisis_date = EXCLUDED.peak_crisis_date,
        dates = EXCLUDED.dates,
        rumor_period = EXCLUDED.rumor_period,
        phases = EXCLUDED.phases,
        pair_impacts = EXCLUDED.pair_impacts,
        macro_backdrop = EXCLUDED.macro_backdrop,
        lessons_learned = EXCLUDED.lessons_learned,
        short_description = EXCLUDED.short_description,
        detailed_description = EXCLUDED.detailed_description,
        trading_notes = EXCLUDED.trading_notes,
        global_spillover = EXCLUDED.global_spillover,
        synced_at = NOW()
      `,
      [
        geo.event_id,
        geo.event_name,
        geo.aliases || [],
        geo.category,
        geo.status,
        geo.dates.start_date,
        geo.dates.end_date,
        geo.dates.peak_crisis_date,
        JSON.stringify(geo.dates),
        geo.rumor_period ? JSON.stringify(geo.rumor_period) : null,
        JSON.stringify(geo.phases),
        JSON.stringify(geo.pair_impacts),
        geo.macro_backdrop ? JSON.stringify(geo.macro_backdrop) : null,
        geo.lessons_learned ? JSON.stringify(geo.lessons_learned) : null,
        geo.short_description,
        geo.detailed_description,
        geo.trading_notes,
        geo.global_spillover,
      ]
    );
    geoCount++;
  }
  console.log(`✓ Synced ${geoCount} geopolitical events\n`);

  // Verify counts
  const eventResult = await client.query("SELECT COUNT(*) FROM event_definitions");
  const speakerResult = await client.query("SELECT COUNT(*) FROM speaker_definitions");
  const geoResult = await client.query("SELECT COUNT(*) FROM geopolitical_events");

  console.log("═══════════════════════════════════════════");
  console.log("Sync complete:");
  console.log(`  event_definitions:    ${eventResult.rows[0].count} rows`);
  console.log(`  speaker_definitions:  ${speakerResult.rows[0].count} rows`);
  console.log(`  geopolitical_events:  ${geoResult.rows[0].count} rows`);
  console.log("═══════════════════════════════════════════\n");

  await client.end();
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
