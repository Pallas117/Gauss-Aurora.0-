// Mock import.meta.env for Jest
const metaMock = {
    env: {
        VITE_HELIO_PROXY_URL: "http://localhost:3001",
        VITE_CANVAS_PRESERVE_BUFFER: "false"
    }
};

// Polyfill process.env
if (typeof process !== 'undefined') {
    process.env.VITE_SUPABASE_URL = "https://mock.supabase.co";
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY = "mock-key";
}

// Polyfill import.meta
if (typeof module !== 'undefined' && module.exports) {
    // @ts-ignore
    global.import = {
        meta: metaMock
    };
} else {
    // fallback for browser-like envs where global is window
    // @ts-ignore
    window.import = {
        meta: metaMock
    };
}
