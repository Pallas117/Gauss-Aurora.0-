export type Vec3 = [number, number, number];

export class MVPoint {
  constructor(public position: Vec3, public meta?: Record<string, unknown>) {}
}

export class MVLine {
  constructor(public from: Vec3, public to: Vec3, public meta?: Record<string, unknown>) {}
}

export class MVPlane {
  constructor(
    public origin: Vec3,
    public normal: Vec3,
    public size: { w: number; h: number },
    public meta?: Record<string, unknown>,
  ) {}
}

export class MVVolume {
  constructor(
    public center: Vec3,
    public radius: number,
    public confidence: number,
    public meta?: Record<string, unknown>,
  ) {}
}

export const Transform = {
  temporalPrediction: (pos: Vec3, vel: Vec3, dtSeconds: number): Vec3 => [
    pos[0] + vel[0] * dtSeconds,
    pos[1] + vel[1] * dtSeconds,
    pos[2] + vel[2] * dtSeconds,
  ],

  confidenceScale: (value: number, confidence: number, gamma = 1.6) =>
    value * Math.pow(Math.max(0, Math.min(1, confidence)), gamma),

  relativeOrbit: (primary: Vec3, secondary: Vec3): Vec3 => [
    secondary[0] - primary[0],
    secondary[1] - primary[1],
    secondary[2] - primary[2],
  ],
};
