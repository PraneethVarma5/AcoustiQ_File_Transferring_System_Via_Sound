
import {
  DISCOVERY_CONFIG,
  getDiscoverySequence,
  type DiscoverySignal,
} from "../protocol/discovery";

import { getLocalIdentitySymbols } from "../protocol/identity";

export async function transmitDiscoverySequence(
  volume = 0.2
): Promise<void> {
  const audioContext = new AudioContext();

  try {
    await audioContext.resume();

    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();

    oscillator.type = "sine";

    gain.gain.setValueAtTime(0, audioContext.currentTime);

    oscillator.connect(gain);
    gain.connect(audioContext.destination);

    const startTime =
      audioContext.currentTime +
      DISCOVERY_CONFIG.startDelayMs / 1000;

    let currentTime = startTime;

    // Existing discovery preamble: 12 symbols.
    const discoverySequence = getDiscoverySequence();

    // Append persistent device ID + CRC-8: 40 symbols.
    const identitySymbols = getLocalIdentitySymbols();

    const identitySequence: DiscoverySignal[] =
      identitySymbols.map((symbol) => ({
        symbol,
        frequency:
          symbol === "A"
            ? DISCOVERY_CONFIG.frequencyA
            : DISCOVERY_CONFIG.frequencyB,
        durationMs: DISCOVERY_CONFIG.symbolDurationMs,
        guardIntervalMs: DISCOVERY_CONFIG.guardIntervalMs,
      }));

    const completeSequence = [
      ...discoverySequence,
      ...identitySequence,
    ];

    for (const item of completeSequence) {
      const duration = item.durationMs / 1000;
      const guard = item.guardIntervalMs / 1000;
      const fade = 0.015;

      oscillator.frequency.setValueAtTime(
        item.frequency,
        currentTime
      );

      // Fade in to avoid clicks.
      gain.gain.setValueAtTime(0, currentTime);
      gain.gain.linearRampToValueAtTime(
        volume,
        currentTime + fade
      );

      // Fade out before the guard interval.
      gain.gain.setValueAtTime(
        volume,
        currentTime + duration - fade
      );

      gain.gain.linearRampToValueAtTime(
        0,
        currentTime + duration
      );

      currentTime += duration + guard;
    }

    oscillator.start(audioContext.currentTime);
    oscillator.stop(currentTime);

    await new Promise<void>((resolve) => {
      oscillator.onended = () => resolve();
    });
  } finally {
    await audioContext.close();
  }
}
