export async function buildFingerprint(): Promise<string> {
  const canvas = document.createElement("canvas");
  const gl = canvas.getContext("webgl") || canvas.getContext("experimental-webgl");
  const debugInfo = gl ? (gl as WebGLRenderingContext).getExtension("WEBGL_debug_renderer_info") : null;
  const renderer = debugInfo ? (gl as WebGLRenderingContext).getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) : "unknown";
  
  const components = [
    renderer,
    navigator.hardwareConcurrency || 0,
    `${window.screen.width}x${window.screen.height}`,
    window.screen.colorDepth,
    // Attempt to get device count if permitted
    (await navigator.mediaDevices.enumerateDevices()).length
  ];
  
  const msg = components.join("|");
  const msgBuffer = new TextEncoder().encode(msg);
  const hashBuffer = await crypto.subtle.digest("SHA-256", msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
}

export async function verifyFingerprint(): Promise<boolean> {
  const stored = localStorage.getItem("gauss_operator_fingerprint");
  if (!stored) return false;
  
  const current = await buildFingerprint();
  return current === stored;
}

export async function learnDevice(): Promise<void> {
  const fingerprint = await buildFingerprint();
  localStorage.setItem("gauss_operator_fingerprint", fingerprint);
}
