
import type { DiscoverySymbol } from "./discovery";

const STORAGE_KEY = "acoustiq-device-id";

/**
 * Creates a persistent 32-bit browser/device identifier.
 * This is an identifier, NOT an authentication credential.
 */
export function getDeviceId(): string {
  const existing = localStorage.getItem(STORAGE_KEY);

  if (existing && /^[0-9a-f]{8}$/i.test(existing)) {
    return existing.toUpperCase();
  }

  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);

  const id = Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();

  localStorage.setItem(STORAGE_KEY, id);

  return id;
}

/**
 * CRC-8, polynomial 0x07, initial value 0x00.
 */
function calculateCrc8(bytes: number[]): number {
  let crc = 0;

  for (const byte of bytes) {
    crc ^= byte;

    for (let bit = 0; bit < 8; bit++) {
      if ((crc & 0x80) !== 0) {
        crc = ((crc << 1) ^ 0x07) & 0xff;
      } else {
        crc = (crc << 1) & 0xff;
      }
    }
  }

  return crc;
}

function byteToSymbols(byte: number): DiscoverySymbol[] {
  const symbols: DiscoverySymbol[] = [];

  for (let bit = 7; bit >= 0; bit--) {
    symbols.push(
      ((byte >> bit) & 1) === 0 ? "A" : "B"
    );
  }

  return symbols;
}

/**
 * Encodes the 32-bit device ID followed by its CRC-8 byte.
 * A = binary 0, B = binary 1.
 *
 * Output: 40 acoustic symbols.
 */
export function encodeDeviceIdentity(
  deviceId: string
): DiscoverySymbol[] {
  if (!/^[0-9a-f]{8}$/i.test(deviceId)) {
    throw new Error("Device ID must contain exactly 8 hexadecimal characters.");
  }

  const bytes: number[] = [];

  for (let index = 0; index < deviceId.length; index += 2) {
    bytes.push(parseInt(deviceId.slice(index, index + 2), 16));
  }

  const crc = calculateCrc8(bytes);
  const packetBytes = [...bytes, crc];

  return packetBytes.flatMap(byteToSymbols);
}

/**
 * Returns the current device's ID encoded as acoustic symbols.
 */
export function getLocalIdentitySymbols(): DiscoverySymbol[] {
  return encodeDeviceIdentity(getDeviceId());
}
