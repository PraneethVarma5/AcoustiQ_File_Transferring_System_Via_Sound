import {
  DISCOVERY_PATTERN,
  DISCOVERY_CONFIG,
  type DiscoverySymbol,
} from "../protocol/discovery";

export interface ReceiverMetrics {
  signalDb: number;
  noiseDb: number;
  snrDb: number;
  detected: boolean;
  lastSymbol?: DiscoverySymbol | null;
  receivedSymbols?: number;
  totalSymbolsRecorded?: number;
  microphoneActive?: boolean;
  deviceId?: string | null;
  identityValid?: boolean;
  identityStatus?: "waiting" | "receiving" | "verified" | "crc_failed";
}

const ANALYSER_FFT_SIZE = 2048;
const MIN_RMS = 0.00005;
const MIN_TONE_POWER = 1e-12;
const MIN_DOMINANCE_RATIO = 3.0;

const SLOT_MS =
  DISCOVERY_CONFIG.symbolDurationMs +
  DISCOVERY_CONFIG.guardIntervalMs;

const PREAMBLE_SYMBOLS = [
  ...DISCOVERY_PATTERN,
  ...DISCOVERY_PATTERN,
] as const;

const IDENTITY_PACKET_BYTES = 5;
const IDENTITY_PACKET_SYMBOLS = IDENTITY_PACKET_BYTES * 8;

interface AudioObservation {
  time: number;
  symbol: DiscoverySymbol | null;
  signalDb: number;
  noiseDb: number;
  snrDb: number;
}

function calculateCrc8(bytes: number[]): number {
  let crc = 0;

  for (const byte of bytes) {
    crc ^= byte;

    for (let bit = 0; bit < 8; bit++) {
      crc =
        (crc & 0x80) !== 0
          ? ((crc << 1) ^ 0x07) & 0xff
          : (crc << 1) & 0xff;
    }
  }

  return crc;
}

function decodeIdentity(
  symbols: DiscoverySymbol[],
  hasErasure: boolean
): { deviceId: string; valid: boolean } | null {
  if (symbols.length !== IDENTITY_PACKET_SYMBOLS) return null;

  const bytes: number[] = [];

  for (let byteIndex = 0; byteIndex < IDENTITY_PACKET_BYTES; byteIndex++) {
    let value = 0;

    for (let bitIndex = 0; bitIndex < 8; bitIndex++) {
      const symbol = symbols[byteIndex * 8 + bitIndex];
      value = (value << 1) | (symbol === "B" ? 1 : 0);
    }

    bytes.push(value);
  }

  const dataBytes = bytes.slice(0, 4);
  const receivedCrc = bytes[4];
  const calculatedCrc = calculateCrc8(dataBytes);

  const deviceId = dataBytes
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();

  return {
    deviceId,
    valid: !hasErasure && receivedCrc === calculatedCrc,
  };
}

/**
 * Calculates the Goertzel power at one target frequency.
 * This avoids depending on FFT-bin rounding for the two FSK tones.
 */
function goertzelPower(
  samples: Float32Array,
  sampleRate: number,
  targetFrequency: number
): number {
  const omega = (2 * Math.PI * targetFrequency) / sampleRate;
  const coefficient = 2 * Math.cos(omega);

  let previous = 0;
  let previous2 = 0;

  for (let i = 0; i < samples.length; i++) {
    const current =
      samples[i] + coefficient * previous - previous2;

    previous2 = previous;
    previous = current;
  }

  const power =
    previous2 * previous2 +
    previous * previous -
    coefficient * previous * previous2;

  return Math.max(0, power) / (samples.length * samples.length);
}

function toDb(value: number): number {
  return 10 * Math.log10(Math.max(value, 1e-12));
}

export async function startListening(
  onMetrics: (metrics: ReceiverMetrics) => void
): Promise<() => void> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      channelCount: 1,
    },
  });

  let audioContext: AudioContext | null = null;

  try {
    audioContext = new AudioContext();
    await audioContext.resume();

    const microphone = audioContext.createMediaStreamSource(stream);
    const analyser = audioContext.createAnalyser();

    analyser.fftSize = ANALYSER_FFT_SIZE;
    analyser.smoothingTimeConstant = 0;
    microphone.connect(analyser);

    const samples = new Float32Array(analyser.fftSize);
    const frequencyA = DISCOVERY_CONFIG.frequencyA;
    const frequencyB = DISCOVERY_CONFIG.frequencyB;

    const observations: AudioObservation[] = [];

    let animationId = 0;
    let frameCount = 0;
    let stopped = false;

    let lastDiscoveryTime = -Infinity;
    let packetStartTime: number | null = null;
    let identitySymbols: DiscoverySymbol[] = [];
    let identityHadErasure = false;
    let lastPacketSymbolCount = 0;

    let deviceId: string | null = null;
    let identityValid = false;
    let identityStatus:
      | "waiting"
      | "receiving"
      | "verified"
      | "crc_failed" = "waiting";

    let lastPreambleCheck = -Infinity;
    let totalSymbolsRecorded = 0;
    let lastDiagnosticSymbol: DiscoverySymbol | null = null;
    let lastDiagnosticToneTime = -Infinity;

    function classifyCurrentAudio(time: number): AudioObservation {
      analyser.getFloatTimeDomainData(samples);

      let sumSquares = 0;
      for (let i = 0; i < samples.length; i++) {
        sumSquares += samples[i] * samples[i];
      }

      const rms = Math.sqrt(sumSquares / samples.length);
      const powerA = goertzelPower(
        samples,
        audioContext!.sampleRate,
        frequencyA
      );
      const powerB = goertzelPower(
        samples,
        audioContext!.sampleRate,
        frequencyB
      );

      const strongest = Math.max(powerA, powerB);
      const weakest = Math.min(powerA, powerB);
      const ratio = strongest / Math.max(weakest, 1e-12);

      let symbol: DiscoverySymbol | null = null;

      if (
        rms >= MIN_RMS &&
        strongest >= MIN_TONE_POWER &&
        ratio >= MIN_DOMINANCE_RATIO
      ) {
        symbol = powerA > powerB ? "A" : "B";
      }

      const signalDb = toDb(strongest);
      const noiseDb = toDb(weakest);

      return {
        time,
        symbol,
        signalDb,
        noiseDb,
        snrDb: signalDb - noiseDb,
      };
    }

    /**
     * Reads the majority classification around a known symbol-center time.
     * The receiver deliberately ignores the tone edges and guard interval.
     */
    function classifyAt(targetTime: number): DiscoverySymbol | null {
      const windowMs = 35;
      const matching = observations.filter(
        (item) =>
          Math.abs(item.time - targetTime) <= windowMs &&
          item.symbol !== null
      );

      const countA = matching.filter((item) => item.symbol === "A").length;
      const countB = matching.filter((item) => item.symbol === "B").length;

      if (matching.length < 2) return null;

      if (countA >= 2 && countA > countB) return "A";
      if (countB >= 2 && countB > countA) return "B";

      return null;
    }

    function preambleMatches(candidateStart: number): boolean {
      for (let index = 0; index < PREAMBLE_SYMBOLS.length; index++) {
        const centerTime =
          candidateStart +
          index * SLOT_MS +
          DISCOVERY_CONFIG.symbolDurationMs / 2;

        if (classifyAt(centerTime) !== PREAMBLE_SYMBOLS[index]) {
          return false;
        }
      }

      return true;
    }

    function searchForPreamble(now: number): void {
      if (now - lastPreambleCheck < 80) return;
      lastPreambleCheck = now;

      // The final preamble symbol's center is 11 slots + half a tone
      // after the start of the transmitted sequence.
      const finalCenterOffset =
        (PREAMBLE_SYMBOLS.length - 1) * SLOT_MS +
        DISCOVERY_CONFIG.symbolDurationMs / 2;

      const estimatedStart = now - finalCenterOffset;

      // Search a small timing range to absorb browser/audio scheduling jitter.
      for (let offset = -100; offset <= 100; offset += 10) {
        const candidateStart = estimatedStart + offset;

        if (preambleMatches(candidateStart)) {
          packetStartTime = candidateStart;
          lastDiscoveryTime = now;

          identitySymbols = [];
          identityHadErasure = false;
          lastPacketSymbolCount = 0;

          deviceId = null;
          identityValid = false;
          identityStatus = "receiving";
          return;
        }
      }
    }

    function processIdentity(now: number): void {
      if (packetStartTime === null) return;

      while (identitySymbols.length < IDENTITY_PACKET_SYMBOLS) {
        const index = identitySymbols.length;
        const centerTime =
          packetStartTime +
          PREAMBLE_SYMBOLS.length * SLOT_MS +
          index * SLOT_MS +
          DISCOVERY_CONFIG.symbolDurationMs / 2;

        // Wait until the complete center sampling window has passed.
        if (now < centerTime + 40) return;

        const symbol = classifyAt(centerTime);

        if (symbol === null) {
          // Preserve slot alignment. CRC will reject a packet with an erasure.
          identitySymbols.push("A");
          identityHadErasure = true;
        } else {
          identitySymbols.push(symbol);
        }

        lastPacketSymbolCount = identitySymbols.length;
      }

      const result = decodeIdentity(identitySymbols, identityHadErasure);

      if (result?.valid) {
        deviceId = result.deviceId;
        identityValid = true;
        identityStatus = "verified";
      } else {
        deviceId = null;
        identityValid = false;
        identityStatus = "crc_failed";
      }

      packetStartTime = null;
    }

    function analyzeAudio(): void {
      if (stopped) return;

      const now = performance.now();
      const observation = classifyCurrentAudio(now);
      observations.push(observation);

      // Keep enough history for the preamble and its timing search.
      while (
        observations.length > 0 &&
        now - observations[0].time > 4200
      ) {
        observations.shift();
      }

      // Diagnostic only: count transitions into tone-like detections.
      if (observation.symbol !== null) {
        if (observation.symbol !== lastDiagnosticSymbol) {
          totalSymbolsRecorded++;
          lastDiagnosticSymbol = observation.symbol;
        }
        lastDiagnosticToneTime = now;
      } else if (now - lastDiagnosticToneTime > 60) {
        lastDiagnosticSymbol = null;
      }

      if (packetStartTime === null) {
        searchForPreamble(now);
      } else {
        processIdentity(now);
      }

      frameCount++;

      if (frameCount % 6 === 0) {
        onMetrics({
          signalDb: observation.signalDb,
          noiseDb: observation.noiseDb,
          snrDb: observation.snrDb,
          detected: now - lastDiscoveryTime < 20000,
          lastSymbol: observation.symbol,
          receivedSymbols: lastPacketSymbolCount,
          totalSymbolsRecorded,
          microphoneActive: stream.getAudioTracks().some(
            (track) => track.readyState === "live" && track.enabled
          ),
          deviceId,
          identityValid,
          identityStatus,
        });
      }

      animationId = requestAnimationFrame(analyzeAudio);
    }

    analyzeAudio();

    return () => {
      stopped = true;
      cancelAnimationFrame(animationId);
      microphone.disconnect();
      stream.getTracks().forEach((track) => track.stop());
      void audioContext?.close();
    };
  } catch (error) {
    stream.getTracks().forEach((track) => track.stop());

    if (audioContext) {
      await audioContext.close();
    }

    throw error;
  }
}
