/**
 * Strategy Loader
 *
 * Functions for loading strategy definitions and visuals from the file system.
 */

import fs from "fs";
import path from "path";
import {
  StrategyDefinition,
  StrategyVisuals,
  LoadedStrategy,
  StrategyListItem,
} from "./types";

/**
 * Base path for strategies directory
 */
const STRATEGIES_DIR = path.join(process.cwd(), "strategies");

/**
 * Get list of all available strategies
 */
export function getStrategyList(): StrategyListItem[] {
  const strategies: StrategyListItem[] = [];

  if (!fs.existsSync(STRATEGIES_DIR)) {
    return strategies;
  }

  const dirs = fs.readdirSync(STRATEGIES_DIR, { withFileTypes: true });

  for (const dir of dirs) {
    if (!dir.isDirectory()) continue;

    const strategyPath = path.join(STRATEGIES_DIR, dir.name);
    const definitionPath = path.join(strategyPath, "strategy.json");

    if (!fs.existsSync(definitionPath)) continue;

    try {
      const definition = JSON.parse(
        fs.readFileSync(definitionPath, "utf-8")
      ) as StrategyDefinition;

      const visualsPath = path.join(strategyPath, "visuals.json");
      const hasVisuals = fs.existsSync(visualsPath);

      strategies.push({
        id: dir.name,
        name: definition.name || dir.name,
        version: definition.version || "1.0",
        summary: definition.description,
        hasVisuals,
      });
    } catch (error) {
      console.error(`Failed to load strategy ${dir.name}:`, error);
    }
  }

  return strategies;
}

/**
 * Load a strategy definition by ID
 */
export function loadStrategyDefinition(strategyId: string): StrategyDefinition | null {
  const definitionPath = path.join(STRATEGIES_DIR, strategyId, "strategy.json");

  if (!fs.existsSync(definitionPath)) {
    return null;
  }

  try {
    return JSON.parse(fs.readFileSync(definitionPath, "utf-8")) as StrategyDefinition;
  } catch (error) {
    console.error(`Failed to load strategy definition ${strategyId}:`, error);
    return null;
  }
}

/**
 * Load strategy visuals by ID
 */
export function loadStrategyVisuals(strategyId: string): StrategyVisuals | null {
  const visualsPath = path.join(STRATEGIES_DIR, strategyId, "visuals.json");

  if (!fs.existsSync(visualsPath)) {
    return null;
  }

  try {
    return JSON.parse(fs.readFileSync(visualsPath, "utf-8")) as StrategyVisuals;
  } catch (error) {
    console.error(`Failed to load strategy visuals ${strategyId}:`, error);
    return null;
  }
}

/**
 * Load a complete strategy (definition + visuals)
 */
export function loadStrategy(strategyId: string): LoadedStrategy | null {
  const definition = loadStrategyDefinition(strategyId);

  if (!definition) {
    return null;
  }

  const visuals = loadStrategyVisuals(strategyId);

  return {
    id: strategyId,
    definition,
    visuals,
    customIndicators: new Map(),
  };
}

/**
 * Validate a visuals.json file against the schema
 */
export function validateVisuals(visuals: unknown): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (!visuals || typeof visuals !== "object") {
    return { valid: false, errors: ["Visuals must be an object"] };
  }

  const v = visuals as Record<string, unknown>;

  // Required fields
  if (!v.strategyId || typeof v.strategyId !== "string") {
    errors.push("Missing or invalid strategyId");
  }

  // Indicators array
  if (v.indicators) {
    if (!Array.isArray(v.indicators)) {
      errors.push("indicators must be an array");
    } else {
      for (let i = 0; i < v.indicators.length; i++) {
        const ind = v.indicators[i] as Record<string, unknown>;
        if (!ind.id) errors.push(`indicators[${i}]: missing id`);
        if (!ind.type) errors.push(`indicators[${i}]: missing type`);
        if (!ind.params) errors.push(`indicators[${i}]: missing params`);
        if (!ind.style) errors.push(`indicators[${i}]: missing style`);
      }
    }
  }

  // Custom indicators
  if (v.customIndicators && !Array.isArray(v.customIndicators)) {
    errors.push("customIndicators must be an array");
  }

  // Markers
  if (v.markers && typeof v.markers !== "object") {
    errors.push("markers must be an object");
  }

  // Zones
  if (v.zones && typeof v.zones !== "object") {
    errors.push("zones must be an object");
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Get the path to a custom indicator module
 */
export function getCustomIndicatorPath(strategyId: string, modulePath: string): string {
  // modulePath is relative to the strategy directory, e.g., "./custom/spike-detector"
  const cleanPath = modulePath.replace(/^\.\//, "");
  return path.join(STRATEGIES_DIR, strategyId, cleanPath);
}

/**
 * Check if a strategy exists
 */
export function strategyExists(strategyId: string): boolean {
  const strategyPath = path.join(STRATEGIES_DIR, strategyId);
  return fs.existsSync(strategyPath);
}

/**
 * Get strategy directory path
 */
export function getStrategyPath(strategyId: string): string {
  return path.join(STRATEGIES_DIR, strategyId);
}
