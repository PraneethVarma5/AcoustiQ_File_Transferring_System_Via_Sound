
/**
 * ACOUSTIQ - Discovery Protocol
 *
 * Defines the acoustic signal pattern used by devices
 * to announce their presence to nearby devices.
 *
 * This is an experimental V1 protocol, not a finalized
 * or authenticated communication protocol.
 */

export const DISCOVERY_CONFIG = {
  // Frequencies used to represent the two symbols.
  frequencyA: 1500,
  frequencyB: 2000,

  // Duration of each transmitted symbol.
  symbolDurationMs: 200,

  // Silence between symbols.
  guardIntervalMs: 50,

  // Number of times the complete pattern is transmitted.
  repeatCount: 2,

  // Small initial silence before transmission.
  startDelayMs: 300,
} as const;

// A = 1500 Hz
// B = 2000 Hz
//
// The receiver must detect the complete pattern,
// not just one individual frequency.
export const DISCOVERY_PATTERN = [
  "A",
  "A",
  "B",
  "A",
  "B",
  "B",
] as const;

export type DiscoverySymbol = "A" | "B";

export interface DiscoverySignal {
  symbol: DiscoverySymbol;
  frequency: number;
  durationMs: number;
  guardIntervalMs: number;
}

export function getDiscoverySequence(): DiscoverySignal[] {
  const sequence: DiscoverySignal[] = [];

  for (let repeat = 0; repeat < DISCOVERY_CONFIG.repeatCount; repeat++) {
    for (const symbol of DISCOVERY_PATTERN) {
      sequence.push({
        symbol,
        frequency:
          symbol === "A"
            ? DISCOVERY_CONFIG.frequencyA
            : DISCOVERY_CONFIG.frequencyB,
        durationMs: DISCOVERY_CONFIG.symbolDurationMs,
        guardIntervalMs: DISCOVERY_CONFIG.guardIntervalMs,
      });
    }
  }

  return sequence;
}

export function getDiscoveryDurationMs(): number {
  const sequence = getDiscoverySequence();

  return (
    DISCOVERY_CONFIG.startDelayMs +
    sequence.reduce(
      (total, item) =>
        total + item.durationMs + item.guardIntervalMs,
      0
    )
  );
}
