/**
 * Jest-compatible stub for base-url.ts.
 * The real module uses import.meta which Jest cannot parse in CJS mode.
 */
export function getApiBaseUrl(_defaultPort = 3001): string {
    return "http://localhost:3001";
}

export function resolveHostAwareBaseUrl(
    _envBaseUrlInput: string | null | undefined,
    defaultPort: number,
): string {
    return `http://localhost:${defaultPort}`;
}
