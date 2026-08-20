/**
 * Shared backend utilities.
 */
import os from "node:os";
import { execSync } from "node:child_process";

/**
 * Filter a sequence of points by a lookback duration and limit the result.
 */
export function parseLookback(value: unknown, fallbackMs: number): number {
    if (typeof value !== "string" || value.length === 0) {
        return fallbackMs;
    }
    const match = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/i.exec(value.trim());
    if (!match) {
        return fallbackMs;
    }
    const h = Number(match[1] ?? 0);
    const m = Number(match[2] ?? 0);
    const s = Number(match[3] ?? 0);
    const total = ((h * 60 + m) * 60 + s) * 1000;
    return total > 0 ? total : fallbackMs;
}

export function toAgeSeconds(timestamp: string | null | undefined): number | null {
    if (!timestamp) {
        return null;
    }
    const ts = Date.parse(timestamp);
    if (!Number.isFinite(ts)) {
        return null;
    }
    return Math.max(0, (Date.now() - ts) / 1000);
}

export function filterByLookback<T extends { timestamp: string }>(
    points: T[],
    lookbackMs: number,
    limit: number,
): T[] {
    const threshold = Date.now() - lookbackMs;
    const filtered = points.filter((point) => {
        const ts = Date.parse(point.timestamp);
        return !isNaN(ts) && ts >= threshold;
    });
    return filtered.slice(Math.max(0, filtered.length - limit));
}

/**
 * Parse an environment variable as a boolean.
 */
export function parseEnvBool(key: string, defaultValue: boolean): boolean {
    const value = process.env[key];
    if (value === undefined) return defaultValue;
    return value.toLowerCase() === "true" || value === "1";
}

/**
 * Parse an environment variable as an integer.
 */
export function parseEnvInt(key: string, defaultValue: number): number {
    const value = process.env[key];
    if (value === undefined) return defaultValue;
    const parsed = parseInt(value, 10);
    return Number.isNaN(parsed) ? defaultValue : parsed;
}

/**
 * Detect Tailscale IPv4 address on this machine.
 * It first inspects local network interfaces for any interface having an IPv4 address
 * starting with "100." (Tailscale's CGNAT address block: 100.64.0.0/10).
 * If that fails, it tries executing the 'tailscale ip -4' command.
 */
export function detectTailscaleIp(): string | null {
    try {
        const interfaces = os.networkInterfaces();
        for (const name of Object.keys(interfaces)) {
            const info = interfaces[name];
            if (info) {
                for (const addr of info) {
                    if (addr.family === "IPv4" && addr.address.startsWith("100.")) {
                        return addr.address;
                    }
                }
            }
        }
    } catch {
        // Ignore and try CLI fallback
    }

    try {
        const stdout = execSync("tailscale ip -4", { stdio: ["ignore", "pipe", "ignore"] });
        const ip = stdout.toString().trim();
        if (/^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$/.test(ip)) {
            return ip;
        }
    } catch {
        // Ignore
    }

    return null;
}
