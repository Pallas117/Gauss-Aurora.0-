# Demo Mode Guide

## Overview

Gauss Aurora includes built-in demo mode support that allows the application to run seamlessly without requiring backend services or API credentials. This is perfect for:

- **Presentations and demos** where internet connectivity may be unreliable
- **Development environments** without access to production credentials
- **Showcasing the UI/UX** without needing full infrastructure
- **Testing visual components** independently

## How Demo Mode Works

### Automatic Detection

Demo mode is automatically activated when:

1. `VITE_SUPABASE_URL` environment variable is not set
2. `VITE_SUPABASE_PUBLISHABLE_KEY` environment variable is not set

When either of these conditions is true, the application switches to demo mode with:
- **Mock space weather data** with realistic, animated values
- **Graceful error handling** for all API endpoints
- **Visual indicator** showing "DEMO" badge in the HUD
- **No console errors** in production builds

### Visual Indicators

When running in demo mode, users will see:

- **"DEMO" badge** in the top-right HUD panel (blue text)
- **Simulated data** that updates smoothly with realistic patterns
- **All visualization features** working normally

## Running in Demo Mode

### Quick Start (No Configuration)

```bash
# Clone the repository
git clone <repository-url>
cd Gauss-Aurora.0-

# Install dependencies
npm install

# Run without any environment variables
npm run dev
```

The application will automatically start in demo mode with simulated data.

### With Docker/Deployment

When deploying without backend services:

```bash
# Build the application
npm run build

# Serve the static files
npm run preview
# or use any static file server
```

The built application works standalone without environment variables.

## Features Available in Demo Mode

✅ **Fully Functional:**
- 3D magnetosphere visualization
- Van Allen radiation belt rendering
- Magnetic field line visualization
- Real-time data interpolation (mock data)
- All UI controls and layer toggles
- Theme switching
- Screenshot capture
- Performance monitoring
- Smooth animations

⚠️ **Limited/Simulated:**
- Space weather data (uses mock generator)
- Historical data queries (returns empty arrays)
- Real-time API updates (simulated with patterns)

❌ **Not Available:**
- Live NOAA/NASA data feeds
- User authentication
- Data persistence
- Backend API calls

## Mock Data Characteristics

The demo mode generates realistic space weather data with:

### Solar Wind Parameters
- **Speed:** 380-510 km/s with sinusoidal variations
- **Density:** 2.5-9.5 p/cm³ with natural fluctuations
- **Pressure:** 2-4 nPa varying realistically

### Magnetic Field
- **IMF Bz:** -5 to +7 nT with smooth transitions
- Simulates both positive and negative conditions

### Activity Indices
- **Kp Index:** 0-7 range with gradual changes
- Reflects realistic geomagnetic activity patterns

### Particle Flux
- **Proton Flux:** 0.3-4.3 pfu
- **Electron Flux:** 1100-4900 electrons/cm²/s/sr

All values update smoothly with natural variations that mimic real space weather patterns.

## Development Best Practices

### Checking Demo Mode Status

```typescript
import { isDemoMode } from '@/integrations/supabase/client';

if (isDemoMode) {
  console.log('Running in demo mode');
  // Use mock data
} else {
  console.log('Running with live backend');
  // Use real API calls
}
```

### Adding New Features

When adding new data-fetching features:

1. **Always provide fallback behavior** for demo mode
2. **Use try-catch** blocks with graceful degradation
3. **Test without environment variables** to ensure demo mode works
4. **Avoid console.log in production** - wrap with `import.meta.env.DEV`

Example pattern:

```typescript
const fetchData = async () => {
  if (isDemoMode) {
    // Return mock data immediately
    return generateMockData();
  }
  
  try {
    // Attempt real API call
    const response = await fetch(apiUrl);
    return await response.json();
  } catch (error) {
    // Graceful fallback
    if (import.meta.env.DEV) {
      console.error('API error:', error);
    }
    return generateMockData();
  }
};
```

## Troubleshooting

### Issue: Application shows errors on startup

**Solution:** Check that all environment-dependent code has fallbacks:
```bash
# Verify demo mode works
npm run build
npm run preview
```

### Issue: "DEMO" badge not showing

**Cause:** Environment variables are set (even if invalid)

**Solution:** Unset or remove `.env` file to activate demo mode:
```bash
rm .env
npm run dev
```

### Issue: Console warnings in production

**Cause:** Debug logging not wrapped in DEV checks

**Solution:** Wrap all console statements:
```typescript
if (import.meta.env.DEV) {
  console.log('Debug info');
}
```

## Configuration Reference

### Environment Variables (Optional)

```env
# Backend Services (omit for demo mode)
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=your-anon-key
VITE_HELIO_PROXY_URL=http://localhost:3001

# Feature Flags
VITE_HELIO_WS_ENABLED=false

# RAG Panel (optional)
VITE_GAUSS_RAG_URL=http://localhost:3001
VITE_GAUSS_RAG_INDEX_DIR=/path/to/docs
```

**Note:** All variables are optional. Omitting them activates demo mode.

## Production Deployment

### Recommended Approach

For production demos without backend:

1. **Build with no environment variables:**
   ```bash
   npm run build
   ```

2. **Deploy static files** from `dist/` directory

3. **Configure CDN/hosting** for SPA routing:
   - Rewrite all routes to `/index.html`
   - Enable gzip compression
   - Set appropriate cache headers

### Example Nginx Configuration

```nginx
server {
    listen 80;
    server_name demo.gauss-aurora.example;
    
    root /var/www/gauss-aurora/dist;
    index index.html;
    
    # SPA routing
    location / {
        try_files $uri $uri/ /index.html;
    }
    
    # Enable compression
    gzip on;
    gzip_types text/css application/javascript application/json;
}
```

## Summary

Demo mode ensures Gauss Aurora can be showcased anywhere, anytime, without dependencies on external services. The application maintains full visual fidelity and interaction while using realistic simulated data, making it perfect for presentations, development, and testing.

For production use with live data, simply provide the required environment variables as documented in `.env.example`.
