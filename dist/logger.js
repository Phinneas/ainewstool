const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
export function createLogger(opts) {
    const minLevel = LEVELS[(opts?.level ?? "info")] ?? LEVELS.info;
    const jsonFormat = (opts?.format ?? "text") === "json";
    function formatText(level, message, data) {
        const ts = new Date().toISOString();
        const tag = level.toUpperCase().padEnd(5);
        let line = `[${ts}] ${tag} ${message}`;
        if (data) {
            const pairs = Object.entries(data)
                .map(([k, v]) => `${k}=${v}`)
                .join(" ");
            if (pairs)
                line += ` ${pairs}`;
        }
        return line;
    }
    function formatJson(level, message, data) {
        return JSON.stringify({
            ts: new Date().toISOString(),
            level,
            msg: message,
            ...data,
        });
    }
    function emit(level, message, data) {
        if (LEVELS[level] < minLevel)
            return;
        const line = jsonFormat
            ? formatJson(level, message, data)
            : formatText(level, message, data);
        if (level === "error") {
            console.error(line);
        }
        else if (level === "warn") {
            console.warn(line);
        }
        else {
            console.log(line);
        }
    }
    function timer(label) {
        const start = performance.now();
        return {
            end() {
                const durationMs = Math.round(performance.now() - start);
                emit("info", `${label} completed`, { durationMs });
            },
        };
    }
    return {
        debug: (msg, data) => emit("debug", msg, data),
        info: (msg, data) => emit("info", msg, data),
        warn: (msg, data) => emit("warn", msg, data),
        error: (msg, data) => emit("error", msg, data),
        timer,
    };
}
/** Default logger instance configured from environment */
export const log = createLogger({
    level: process.env.LOG_LEVEL,
    format: process.env.LOG_FORMAT,
});
