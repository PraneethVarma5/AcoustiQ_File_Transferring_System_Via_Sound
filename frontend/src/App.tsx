
import { useEffect, useRef, useState } from "react";
import {
  Activity,
  ArrowUpRight,
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  Laptop,
  Mic,
  Radio,
  Radar,
  ShieldCheck,
  Smartphone,
  Volume2,
} from "lucide-react";

import { transmitDiscoverySequence } from "./audio/transmitter";
import {
  startListening,
  type ReceiverMetrics,
} from "./audio/receiver";

import "./App.css";

const initialMetrics: ReceiverMetrics = {
  signalDb: -Infinity,
  noiseDb: -Infinity,
  snrDb: 0,
  detected: false,
  lastSymbol: null,
  receivedSymbols: 0,
  totalSymbolsRecorded: 0,
  microphoneActive: false,
  deviceId: null,
  identityValid: false,
  identityStatus: "waiting",
};

function formatDb(value: number) {
  return Number.isFinite(value) ? `${value.toFixed(1)} dB` : "—";
}

function App() {
  const [listening, setListening] = useState(false);
  const [transmitting, setTransmitting] = useState(false);
  const [metrics, setMetrics] = useState(initialMetrics);
  const [showDiagnostics, setShowDiagnostics] = useState(false);

  const [status, setStatus] = useState(
    "Ready to discover nearby devices"
  );

  const [errorMessage, setErrorMessage] = useState("");

  const stopListeningRef = useRef<(() => void) | null>(null);

  async function handleStartDiscovery() {
    if (listening) return;

    try {
      setErrorMessage("");
      setMetrics(initialMetrics);
      setStatus("Requesting microphone access...");

      const stop = await startListening((newMetrics) => {
        setMetrics(newMetrics);

        if (
          newMetrics.identityStatus === "verified" &&
          newMetrics.deviceId
        ) {
          setStatus("Device identity packet received");
        } else if (newMetrics.identityStatus === "receiving") {
          setStatus("Device detected. Receiving identity...");
        } else if (newMetrics.identityStatus === "crc_failed") {
          setStatus("Identity packet corrupted. Waiting for another announcement...");
        } else if (newMetrics.detected) {
          setStatus("Nearby acoustic device detected");
        } else {
          setStatus("Scanning for nearby devices...");
        }
      });

      stopListeningRef.current = stop;
      setListening(true);
      setStatus("Scanning for nearby devices...");
    } catch (error) {
      console.error("Discovery error:", error);

      setStatus("Microphone access unavailable");
      setErrorMessage(
        "Allow microphone access in your browser settings and try again."
      );
    }
  }

  function handleStopDiscovery() {
    stopListeningRef.current?.();
    stopListeningRef.current = null;

    setListening(false);
    setMetrics(initialMetrics);
    setStatus("Discovery stopped");
  }

  async function handleAnnounce() {
    if (transmitting) return;

    try {
      setErrorMessage("");
      setTransmitting(true);
      setStatus("Announcing this device...");

      await transmitDiscoverySequence(0.2);

      setStatus("Device announcement completed");
    } catch (error) {
      console.error("Transmission error:", error);
      setStatus("Announcement failed");
      setErrorMessage(
        "Could not play the acoustic announcement. Check your device audio output."
      );
    } finally {
      setTransmitting(false);
    }
  }

  useEffect(() => {
    return () => {
      stopListeningRef.current?.();
    };
  }, []);

  const hasDevice =
    metrics.detected ||
    metrics.identityStatus === "receiving" ||
    metrics.identityStatus === "verified" ||
    metrics.identityStatus === "crc_failed";

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="ACOUSTIQ home">
          <span className="brand-icon">
            <Radio size={21} strokeWidth={2.2} />
          </span>
          <span>ACOUSTIQ</span>
        </a>

        <div className="topbar-right">
          <span className="offline-indicator">
            <span className="online-dot" />
            Offline mode
          </span>
          <span className="version-label">V1 Prototype</span>
        </div>
      </header>

      <main className="main-content">
        <section className="intro-section">
          <div className="eyebrow">
            <span className="eyebrow-line" />
            ACOUSTIC DEVICE DISCOVERY
          </div>

          <h1>
            Share files.
            <br />
            <span>Without the internet.</span>
          </h1>

          <p className="intro-description">
            Discover nearby devices through sound. No Wi-Fi,
            Bluetooth pairing, or internet connection required
            for acoustic discovery.
          </p>
        </section>

        <section className="discovery-card">
          <div className="card-heading">
            <div>
              <div className="section-kicker">DEVICE DISCOVERY</div>
              <h2>Nearby devices</h2>
            </div>

            <div className={`scan-indicator ${listening ? "scanning" : ""}`}>
              <span className="scan-dot" />
              {listening ? "Scanning" : "Not scanning"}
            </div>
          </div>

          <div className={`radar-area ${listening ? "radar-active" : ""}`}>
            <div className="radar-circle radar-circle-outer" />
            <div className="radar-circle radar-circle-middle" />
            <div className="radar-circle radar-circle-inner" />

            <div className="radar-sweep" />

            <div className="radar-center">
              <Radar size={35} strokeWidth={1.5} />
            </div>

            {hasDevice && (
              <div className="radar-device-marker">
                <span />
              </div>
            )}
          </div>

          <div className="discovery-status">
            {metrics.identityStatus === "verified" ? (
              <CheckCircle2 size={17} className="success-icon" />
            ) : listening ? (
              <Activity size={17} className="activity-icon" />
            ) : (
              <CircleAlert size={17} className="muted-icon" />
            )}

            <span>{status}</span>
          </div>

          {errorMessage && (
            <div className="error-message">
              <CircleAlert size={16} />
              {errorMessage}
            </div>
          )}

          {hasDevice ? (
            <div className="device-result">
              <div className="device-avatar">
                <Laptop size={23} />
              </div>

              <div className="device-details">
                <strong>
                  {metrics.identityStatus === "verified" && metrics.deviceId
                    ? `Device ${metrics.deviceId}`
                    : "Nearby acoustic device"}
                </strong>

                <span>
                  {metrics.identityStatus === "verified"
                    ? "Identity packet received · CRC valid"
                    : metrics.identityStatus === "receiving"
                    ? "Receiving device identity..."
                    : metrics.identityStatus === "crc_failed"
                    ? "Identity packet received · CRC failed"
                    : "Discovery signal received"}
                </span>
              </div>

              <span className="device-status">
                <span />
                {metrics.identityStatus === "verified"
                  ? "Packet valid"
                  : metrics.identityStatus === "receiving"
                  ? "Receiving"
                  : "Detected"}
              </span>

              <div className="device-notice">
                <ShieldCheck size={15} />
                {metrics.identityStatus === "verified"
                  ? "Packet integrity confirmed. Sender authentication is not implemented yet."
                  : metrics.identityStatus === "crc_failed"
                  ? "The identity packet was corrupted. No device ID was accepted."
                  : "Device identity is being received. Connection requests are not available yet."}
              </div>
            </div>
          ) : (
            <div className="empty-state">
              <div className="empty-icon">
                <Smartphone size={22} />
              </div>
              <strong>No devices discovered yet</strong>
              <span>
                Start discovery and announce another device nearby.
              </span>
            </div>
          )}

          <div className="discovery-actions">
            <button
              className="primary-button"
              onClick={
                listening ? handleStopDiscovery : handleStartDiscovery
              }
            >
              <Radar size={18} />
              {listening ? "Stop discovery" : "Find nearby devices"}
            </button>

            <button
              className="secondary-button"
              onClick={handleAnnounce}
              disabled={transmitting}
            >
              <Volume2 size={18} />
              {transmitting ? "Announcing..." : "Announce this device"}
            </button>
          </div>

          <p className="permission-note">
            <Mic size={14} />
            {listening
              ? metrics.microphoneActive
                ? "Microphone active. Listening for acoustic signals."
                : "Microphone stream starting..."
              : "Microphone access is required to discover devices."}
          </p>
        </section>

        <section className="how-it-works">
          <div className="section-kicker">HOW IT WORKS</div>

          <div className="steps-grid">
            <div className="step-item">
              <div className="step-icon">
                <Volume2 size={20} />
              </div>
              <div>
                <strong>1. Announce</strong>
                <p>Your device sends an acoustic discovery signal.</p>
              </div>
            </div>

            <div className="step-item">
              <div className="step-icon">
                <Mic size={20} />
              </div>
              <div>
                <strong>2. Detect</strong>
                <p>Nearby devices listen and recognize the signal.</p>
              </div>
            </div>

            <div className="step-item">
              <div className="step-icon">
                <ArrowUpRight size={20} />
              </div>
              <div>
                <strong>3. Connect</strong>
                <p>Secure connection and file transfer are coming next.</p>
              </div>
            </div>
          </div>
        </section>

        <section className="diagnostics-section">
          <button
            className="diagnostics-toggle"
            onClick={() => setShowDiagnostics(!showDiagnostics)}
          >
            <span>
              <Activity size={17} />
              Engineering diagnostics
            </span>
            <ChevronDown
              size={17}
              className={showDiagnostics ? "chevron-open" : ""}
            />
          </button>

          {showDiagnostics && (
            <div className="diagnostics-content">
              <div className="diagnostic-row">
                <span>Signal level</span>
                <strong>{formatDb(metrics.signalDb)}</strong>
              </div>

              <div className="diagnostic-row">
                <span>Estimated noise</span>
                <strong>{formatDb(metrics.noiseDb)}</strong>
              </div>

              <div className="diagnostic-row">
                <span>Signal-to-noise ratio</span>
                <strong>{formatDb(metrics.snrDb)}</strong>
              </div>

              <div className="diagnostic-row">
                <span>Last detected symbol</span>
                <strong>{metrics.lastSymbol ?? "—"}</strong>
              </div>

              <div className="diagnostic-row">
                <span>Identity packet symbols</span>
                <strong>{metrics.receivedSymbols ?? 0} / 40</strong>
              </div>

              <div className="diagnostic-row">
                <span>Total tone segments (session)</span>
                <strong>{metrics.totalSymbolsRecorded ?? 0}</strong>
              </div>

              <div className="diagnostic-row">
                <span>Microphone</span>
                <strong>{metrics.microphoneActive ? "Active" : "Inactive"}</strong>
              </div>

              <div className="diagnostic-row">
                <span>Discovery status</span>
                <strong>{metrics.detected ? "Matched" : "Waiting"}</strong>
              </div>

              <div className="diagnostic-row">
                <span>Identity status</span>
                <strong>{metrics.identityStatus ?? "waiting"}</strong>
              </div>

              <div className="diagnostic-row">
                <span>Decoded device ID</span>
                <strong>{metrics.deviceId ?? "—"}</strong>
              </div>

              <div className="diagnostic-row">
                <span>CRC check</span>
                <strong>
                  {metrics.identityValid === true
                    ? "Passed"
                    : metrics.identityStatus === "crc_failed"
                    ? "Failed"
                    : "Pending"}
                </strong>
              </div>
            </div>
          )}
        </section>

        <footer className="footer">
          <span>ACOUSTIQ</span>
          <span>Acoustic communication research</span>
          <span>Built for offline discovery</span>
        </footer>
      </main>
    </div>
  );
}

export default App;
