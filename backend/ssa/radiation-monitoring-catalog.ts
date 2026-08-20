type RuntimeState = "observed" | "stale" | "conflicting" | "unknown";

const BASE_SYSTEMS = [
  { id: "goes-r-seiss", name: "GOES-R SEISS", orbitContext: ["geostationary", "outer_radiation_belt"], operationalEffects: ["internal_charging", "single-event upset screening"], dataAccess: [{ url: "https://services.swpc.noaa.gov/json/goes/primary/" }] },
  { id: "dscovr-ace-rtsw", name: "DSCOVR / ACE RTSW", orbitContext: ["l1_upstream"], operationalEffects: ["solar-wind forcing", "geomagnetic-storm warning"], dataAccess: [{ url: "https://services.swpc.noaa.gov/products/solar-wind/" }] },
  { id: "esa-d3s", name: "ESA D3S", orbitContext: ["leo"], operationalEffects: ["radiation environment context"], dataAccess: [{ url: "https://swe.ssa.esa.int/" }], assetInventory: ["Sentinel-6B/NGRM"] },
  { id: "van-allen-probes", name: "Van Allen Probes", orbitContext: ["inner_radiation_belt", "outer_radiation_belt"], operationalEffects: ["belt characterization"], dataAccess: [{ url: "https://rbsp-ect.newmexicoconsortium.org/" }] },
  { id: "arase", name: "Arase", orbitContext: ["inner_radiation_belt", "outer_radiation_belt"], operationalEffects: ["wave-particle interaction context"], dataAccess: [{ url: "https://ergsc.isee.nagoya-u.ac.jp/" }] },
  { id: "elfin", name: "ELFIN", orbitContext: ["leo"], operationalEffects: ["electron precipitation"], dataAccess: [{ url: "https://elfin.igpp.ucla.edu/" }] },
  { id: "cirbe", name: "CIRBE", orbitContext: ["leo"], operationalEffects: ["radiation belt variability"], dataAccess: [{ url: "https://lasp.colorado.edu/missions/cirbe/" }] },
  { id: "cses", name: "CSES", orbitContext: ["leo"], operationalEffects: ["ionospheric context"], dataAccess: [{ url: "https://www.leos.ac.cn/" }] },
  { id: "mms", name: "MMS", orbitContext: ["magnetosphere"], operationalEffects: ["reconnection context"], dataAccess: [{ url: "https://lasp.colorado.edu/mms/" }] },
] as const;

export function buildRadiationMonitoringCatalog(environment: { timestamp?: string; quality?: { stale?: boolean; conflicting?: boolean } } | null = null, nowMs = Date.now()) {
  const environmentState: RuntimeState = environment?.quality?.conflicting ? "conflicting" : environment?.quality?.stale ? "stale" : environment?.timestamp && nowMs - Date.parse(environment.timestamp) >= 0 && nowMs - Date.parse(environment.timestamp) <= 15 * 60 * 1000 ? "observed" : "unknown";
  return { scope: "open_radiation_monitoring_catalog" as const, generatedAt: new Date(nowMs).toISOString(), systems: BASE_SYSTEMS.map((system) => ({ ...system, runtimeState: system.id === "dscovr-ace-rtsw" && environmentState === "observed" ? "observed" as const : "unknown" as const, access: "public", trust: "context_only" })), limitations: ["Catalog entries are monitoring and research context, not proof of spacecraft damage.", "Archive missions are not live coverage unless a bounded adapter reports fresh data.", "Environmental flux is not spacecraft dose or health telemetry."] };
}
