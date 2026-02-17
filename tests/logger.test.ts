import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createLogger } from "../src/logger.js";

describe("logger", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("emits info messages by default", () => {
    const log = createLogger();
    log.info("test message");
    expect(logSpy).toHaveBeenCalledOnce();
    expect(logSpy.mock.calls[0][0]).toContain("INFO");
    expect(logSpy.mock.calls[0][0]).toContain("test message");
  });

  it("includes timestamps in text format", () => {
    const log = createLogger();
    log.info("timestamped");
    const output = logSpy.mock.calls[0][0] as string;
    expect(output).toMatch(/\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it("includes data as key=value pairs in text format", () => {
    const log = createLogger();
    log.info("with data", { count: 5, source: "test" });
    const output = logSpy.mock.calls[0][0] as string;
    expect(output).toContain("count=5");
    expect(output).toContain("source=test");
  });

  it("routes warn to console.warn", () => {
    const log = createLogger();
    log.warn("warning");
    expect(warnSpy).toHaveBeenCalledOnce();
    expect(logSpy).not.toHaveBeenCalled();
  });

  it("routes error to console.error", () => {
    const log = createLogger();
    log.error("failure");
    expect(errorSpy).toHaveBeenCalledOnce();
    expect(logSpy).not.toHaveBeenCalled();
  });

  it("suppresses info when level=warn", () => {
    const log = createLogger({ level: "warn" });
    log.info("should be suppressed");
    log.debug("also suppressed");
    log.warn("should appear");
    expect(logSpy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledOnce();
  });

  it("suppresses everything below error when level=error", () => {
    const log = createLogger({ level: "error" });
    log.debug("no");
    log.info("no");
    log.warn("no");
    log.error("yes");
    expect(logSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledOnce();
  });

  it("shows all levels when level=debug", () => {
    const log = createLogger({ level: "debug" });
    log.debug("d");
    log.info("i");
    log.warn("w");
    log.error("e");
    expect(logSpy).toHaveBeenCalledTimes(2); // debug + info
    expect(warnSpy).toHaveBeenCalledOnce();
    expect(errorSpy).toHaveBeenCalledOnce();
  });

  it("outputs JSON when format=json", () => {
    const log = createLogger({ format: "json" });
    log.info("json test", { key: "value" });
    const output = logSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(output);
    expect(parsed.level).toBe("info");
    expect(parsed.msg).toBe("json test");
    expect(parsed.key).toBe("value");
    expect(parsed.ts).toBeDefined();
  });

  it("timer logs duration on end()", () => {
    const log = createLogger();
    const t = log.timer("test-step");
    t.end();
    expect(logSpy).toHaveBeenCalledOnce();
    const output = logSpy.mock.calls[0][0] as string;
    expect(output).toContain("test-step completed");
    expect(output).toContain("durationMs=");
  });

  it("defaults to info level for unknown level string", () => {
    const log = createLogger({ level: "bogus" });
    log.debug("suppressed");
    log.info("visible");
    expect(logSpy).toHaveBeenCalledOnce();
  });
});
