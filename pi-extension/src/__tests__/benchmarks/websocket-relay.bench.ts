/**
 * WebSocket relay benchmark tests.
 *
 * Measures round-trip latency for the WebSocket relay path:
 *   pi → pi-extension → chrome-extension (mock) → pi-extension → pi
 *
 * Uses a real Bun WebSocket server and mocked browser clients
 * (echo endpoints) to eliminate network flakiness while capturing
 * the overhead of the full relay machinery:
 *   - JSON serialization/deserialization
 *   - Request/response correlation by id
 *   - ws-transport send() path
 *   - Pending request map management
 *
 * ## Usage
 * ```bash
 * # From monorepo root:
 * bun run benchmark
 *
 * # From pi-extension package:
 * bun run benchmark
 *
 * # Directly:
 * bun run pi-extension/src/__tests__/benchmarks/websocket-relay.bench.ts
 * ```
 *
 * ## Performance Targets
 * - p95 round-trip latency: < 50ms
 * - p50 round-trip latency: < 10ms
 *
 * These targets measure the Bun-side overhead only (no real Chrome API
 * calls). Full end-to-end latency (including Chrome API and DOM
 * interaction) will be higher.
 *
 * @module benchmarks/websocket-relay
 */

import { start, stop, send, onResponse } from "../../infrastructure/ws-server.js";

// ── Types ────────────────────────────────────────────────────────────────

interface BenchmarkResult {
  /** Metric name (e.g., "round-trip-latency"). */
  metric: string;
  /** Number of samples collected. */
  samples: number;
  /** Mean latency in milliseconds. */
  mean: number;
  /** Median (p50) latency in milliseconds. */
  p50: number;
  /** 95th percentile latency in milliseconds. */
  p95: number;
  /** 99th percentile latency in milliseconds. */
  p99: number;
  /** Minimum latency in milliseconds. */
  min: number;
  /** Maximum latency in milliseconds. */
  max: number;
  /** Standard deviation in milliseconds. */
  stddev: number;
  /** Whether p95 met the target. */
  targetMet: boolean;
}

interface BenchmarkConfig {
  /** Number of warmup iterations (excluded from results). */
  warmupIterations: number;
  /** Number of measured iterations. */
  iterations: number;
  /** Concurrency level (simultaneous requests). */
  concurrency: number;
  /** Target p95 latency in ms. */
  p95TargetMs: number;
  /** Action to test. */
  action: string;
  /** Params for the action. */
  params: Record<string, unknown>;
}

// ── Helpers ───────────────────────────────────────────────────────────────

/** Sleep for `ms` milliseconds. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Connect a real WebSocket client to the server (simulates chrome-extension). */
function connectClient(port: number): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${port}`);

    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error(`WebSocket connection timed out to port ${port}`));
    }, 3000);

    ws.onopen = () => {
      clearTimeout(timeout);
      resolve(ws);
    };

    ws.onerror = (e) => {
      clearTimeout(timeout);
      reject(new Error(`WebSocket connection failed: ${(e as Event).type}`));
    };
  });
}

// ── Mock Browser Client (simulates chrome-extension) ─────────────────────

/**
 * Creates a mock browser client that echoes a deterministic response
 * for every incoming request. Simulates the chrome-extension acting
 * as a transparent proxy (no actual browser automation).
 */
function createMockBrowser(ws: WebSocket): void {
  ws.onmessage = (event) => {
    const raw = typeof event.data === "string" ? event.data : String(event.data);

    let request: { id?: string; action?: string } = {};
    try {
      request = JSON.parse(raw);
    } catch {
      return; // ignore malformed messages
    }

    if (!request.id) return;

    // Echo a deterministic response simulating a successful browser action
    const response = JSON.stringify({
      id: request.id,
      result: {
        ok: true,
        action: request.action,
        timestamp: Date.now(),
      },
    });

    ws.send(response);
  };
}

// ── Statistics ───────────────────────────────────────────────────────────

/** Compute statistics from an array of latency measurements (ms). */
function computeStats(latencies: number[]): {
  mean: number;
  p50: number;
  p95: number;
  p99: number;
  min: number;
  max: number;
  stddev: number;
} {
  if (latencies.length === 0) {
    return { mean: 0, p50: 0, p95: 0, p99: 0, min: 0, max: 0, stddev: 0 };
  }

  const sorted = [...latencies].sort((a, b) => a - b);
  const n = sorted.length;

  const sum = sorted.reduce((a, b) => a + b, 0);
  const mean = sum / n;

  const variance =
    sorted.reduce((acc, val) => acc + (val - mean) ** 2, 0) / n;
  const stddev = Math.sqrt(variance);

  const p50 = sorted[Math.floor(n * 0.5)]!;
  const p95 = sorted[Math.floor(n * 0.95)]!;
  const p99 = sorted[Math.floor(n * 0.99)]!;

  const r = (v: number) => Math.round(v * 1000) / 1000;

  return {
    mean: r(mean),
    p50: r(p50),
    p95: r(p95),
    p99: r(p99),
    min: r(sorted[0]!),
    max: r(sorted[n - 1]!),
    stddev: r(stddev),
  };
}

// ── Benchmark runner ──────────────────────────────────────────────────────

/**
 * Run a single benchmark scenario.
 *
 * 1. Starts the server on a dynamic port.
 * 2. Connects mock browser clients.
 * 3. Sends `config.iterations` requests, measuring round-trip latency.
 * 4. Computes and prints statistics.
 * 5. Returns whether p95 met the target.
 */
async function runBenchmark(config: BenchmarkConfig): Promise<BenchmarkResult> {
  const clientCount = Math.max(config.concurrency, 1);

  // ── Start server ─────────────────────────────────────────────────────
  const server = await start(0);
  console.log(`\n  Server started on port ${server.port}`);

  // ── Connect mock browser clients ──────────────────────────────────────
  const clients: WebSocket[] = [];
  for (let i = 0; i < clientCount; i++) {
    const ws = await connectClient(server.port);
    createMockBrowser(ws);
    clients.push(ws);
  }
  console.log(`  Connected ${clientCount} mock browser client(s)`);

  // ── Warmup (excluded from measurements) ──────────────────────────────
  if (config.warmupIterations > 0) {
    console.log(`  Warming up (${config.warmupIterations} iterations)...`);
    for (let i = 0; i < config.warmupIterations; i++) {
      try {
        await send({
          id: `warmup-${i}`,
          action: config.action as any,
          params: config.params as any,
        });
      } catch {
        // Ignore warmup failures
      }
    }
  }

  // ── Measured iterations ──────────────────────────────────────────────
  const latencies: number[] = [];
  const startTime = Date.now();

  console.log(
    `  Running ${config.iterations} measured iterations (concurrency: ${config.concurrency})...`,
  );

  const batchSize = config.concurrency;
  let completed = 0;

  for (let i = 0; i < config.iterations; i += batchSize) {
    const batchPromises: Promise<void>[] = [];

    for (let j = 0; j < batchSize && i + j < config.iterations; j++) {
      const iteration = i + j;

      const promise = (async () => {
        const t0 = performance.now();
        try {
          await send({
            id: `bench-${iteration}`,
            action: config.action as any,
            params: config.params as any,
          });
          const t1 = performance.now();
          latencies.push(t1 - t0);
        } catch {
          // Record error as high latency for detection
          latencies.push(999);
        }
        completed++;
        if (completed % 100 === 0) {
          process.stdout.write(".");
        }
      })();

      batchPromises.push(promise);
    }

    await Promise.all(batchPromises);
  }

  const elapsed = Date.now() - startTime;

  // ── Compute stats ────────────────────────────────────────────────────
  const stats = computeStats(latencies);

  // ── Cleanup ──────────────────────────────────────────────────────────
  for (const ws of clients) {
    try {
      ws.close();
    } catch {
      // ignore
    }
  }
  stop();

  // ── Print results ────────────────────────────────────────────────────
  console.log(`\n`);
  console.log(`  ┌─────────────────────────────────────────────┐`);
  console.log(`  │  Metric: ${config.action.padEnd(33)}│`);
  console.log(`  ├─────────────────────────────────────────────┤`);
  console.log(
    `  │  Samples:   ${String(latencies.length).padStart(6).padEnd(31)}│`,
  );
  console.log(
    `  │  Mean:      ${String(stats.mean).padStart(6)} ms${"".padEnd(22)}│`,
  );
  console.log(
    `  │  p50:       ${String(stats.p50).padStart(6)} ms${"".padEnd(22)}│`,
  );
  console.log(
    `  │  p95:       ${String(stats.p95).padStart(6)} ms${"".padEnd(22)}│`,
  );
  console.log(
    `  │  p99:       ${String(stats.p99).padStart(6)} ms${"".padEnd(22)}│`,
  );
  console.log(
    `  │  Min:       ${String(stats.min).padStart(6)} ms${"".padEnd(22)}│`,
  );
  console.log(
    `  │  Max:       ${String(stats.max).padStart(6)} ms${"".padEnd(22)}│`,
  );
  console.log(
    `  │  StdDev:    ${String(stats.stddev).padStart(6)} ms${"".padEnd(22)}│`,
  );
  console.log(
    `  │  Elapsed:   ${String(elapsed).padStart(6)} ms${"".padEnd(22)}│`,
  );
  console.log(
    `  │  Throughput:${String(Math.round(latencies.length / (elapsed / 1000))).padStart(6)} req/s${"".padEnd(19)}│`,
  );

  const targetMet = stats.p95 < config.p95TargetMs;
  const status = targetMet ? "✓ PASS" : "✗ FAIL";
  console.log(
    `  ├─────────────────────────────────────────────┤`,
  );
  console.log(
    `  │  p95 Target: < ${config.p95TargetMs} ms  → ${status.padEnd(16)}│`,
  );
  console.log(
    `  └─────────────────────────────────────────────┘`,
  );

  return {
    metric: `ws-relay-${config.action}`,
    samples: latencies.length,
    mean: stats.mean,
    p50: stats.p50,
    p95: stats.p95,
    p99: stats.p99,
    min: stats.min,
    max: stats.max,
    stddev: stats.stddev,
    targetMet,
  };
}

// ── Benchmark scenarios ──────────────────────────────────────────────────

const SCENARIOS: BenchmarkConfig[] = [
  {
    name: undefined as any, // placeholder for display
    warmupIterations: 50,
    iterations: 1000,
    concurrency: 1,
    p95TargetMs: 50,
    action: "read",
    params: { selector: "body", maxLength: 5000 },
  },
  {
    warmupIterations: 50,
    iterations: 500,
    concurrency: 10,
    p95TargetMs: 50,
    action: "click",
    params: { selector: "#test-button", timeout: 5000 },
  },
  {
    warmupIterations: 50,
    iterations: 500,
    concurrency: 1,
    p95TargetMs: 50,
    action: "navigate",
    params: { url: "https://example.com", waitUntil: "load" },
  },
  {
    warmupIterations: 50,
    iterations: 500,
    concurrency: 1,
    p95TargetMs: 50,
    action: "exec",
    params: { code: "document.title" },
  },
];

// ── Main entry ───────────────────────────────────────────────────────────

async function main() {
  console.log("");
  console.log("╔══════════════════════════════════════════════════════╗");
  console.log("║   Pi Browser Bridge — WebSocket Relay Benchmarks    ║");
  console.log("╠══════════════════════════════════════════════════════╣");
  console.log("║                                                      ║");
  console.log("║   Path: pi → pi-extension → mock → pi-extension → pi║");
  console.log("║   p95 target: < 50ms                                 ║");
  console.log("║   Warmup: 50 iterations per scenario                 ║");
  console.log("║                                                      ║");
  console.log("╚══════════════════════════════════════════════════════╝");
  console.log("");

  const results: BenchmarkResult[] = [];
  let allPassed = true;

  for (const config of SCENARIOS) {
    const result = await runBenchmark(config);
    results.push(result);
    if (!result.targetMet) {
      allPassed = false;
    }

    // Small delay between scenarios for cleanup
    await sleep(200);
  }

  // ── Summary ─────────────────────────────────────────────────────────
  console.log("");
  console.log("═══════════════════════════════════════════════════════");
  console.log("  SUMMARY");
  console.log("═══════════════════════════════════════════════════════");

  for (const r of results) {
    const status = r.targetMet ? "✓" : "✗";
    console.log(
      `  ${status} ${r.metric.padEnd(30)} p95=${String(r.p95).padStart(6)}ms (target < 50ms)  mean=${String(r.mean).padStart(6)}ms  samples=${r.samples}`,
    );
  }

  console.log("═══════════════════════════════════════════════════════");

  if (allPassed) {
    console.log("  ✓ All benchmarks passed — p95 < 50ms");
    console.log("");
    process.exit(0);
  } else {
    console.log("  ✗ Some benchmarks FAILED — p95 exceeded 50ms target");
    console.log("");
    process.exit(1);
  }
}

// ── Run ─────────────────────────────────────────────────────────────────

main().catch((err) => {
  console.error("Benchmark failed:", err);
  process.exit(1);
});
