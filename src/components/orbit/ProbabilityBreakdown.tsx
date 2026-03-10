import { cn } from "@/lib/utils";

export interface ProbabilityFactor {
  name: string;
  weight: number;
  value: number;
  contribution: number;
  unit?: string;
}

export interface ProbabilityThreat {
  id?: string;
  probability?: number;
  confidence_interval?: [number, number];
  confidenceInterval?: [number, number];
  factors?: ProbabilityFactor[];
}

export interface FactorRowProps {
  factor?: ProbabilityFactor | null;
  name?: string;
  weight?: number;
  value?: number;
  contribution?: number;
  unit?: string;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function asPercent(value: number): string {
  return `${(clamp01(value) * 100).toFixed(1)}%`;
}

export function FactorRow({
  factor,
  name,
  weight,
  value,
  contribution,
  unit,
}: FactorRowProps) {
  const fName = factor?.name ?? name ?? "Unknown factor";
  const fWeight = clamp01(Number(factor?.weight ?? weight ?? 0));
  const fValue = Number(factor?.value ?? value ?? 0);
  const fContribution = clamp01(Number(factor?.contribution ?? contribution ?? 0));
  const fUnit = factor?.unit ?? unit ?? "";

  return (
    <li className=" border border-border/70 bg-background/40 px-3 py-2">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="font-semibold text-foreground/90">{fName}</span>
        <span className="text-muted-foreground">{asPercent(fContribution)}</span>
      </div>
      <div className="mt-1 text-[11px] text-muted-foreground">
        w={fWeight.toFixed(2)} | v={fValue.toFixed(2)}
        {fUnit ? ` ${fUnit}` : ""}
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded bg-muted/40">
        <div
          className="h-full rounded bg-primary/80 transition-all duration-200"
          style={{ width: `${fContribution * 100}%` }}
        />
      </div>
    </li>
  );
}

export interface ProbabilityBreakdownProps {
  threat?: ProbabilityThreat | null;
  probability?: number;
  confidence_interval?: [number, number];
  confidenceInterval?: [number, number];
  factors?: ProbabilityFactor[] | null;
  whatIfValue?: number;
  onWhatIfChange?: (next: number) => void;
  className?: string;
}

export function ProbabilityBreakdown({
  threat,
  probability,
  confidence_interval,
  confidenceInterval,
  factors,
  whatIfValue,
  onWhatIfChange,
  className,
}: ProbabilityBreakdownProps) {
  const resolvedProbability = clamp01(
    Number(threat?.probability ?? probability ?? 0),
  );
  const resolvedCi =
    threat?.confidence_interval ??
    threat?.confidenceInterval ??
    confidence_interval ??
    confidenceInterval ??
    [resolvedProbability, resolvedProbability];
  const ciLow = clamp01(Number(resolvedCi[0] ?? resolvedProbability));
  const ciHigh = clamp01(Number(resolvedCi[1] ?? resolvedProbability));
  const resolvedFactors = (threat?.factors ?? factors ?? []).filter(Boolean);
  const sliderValue = clamp01(Number(whatIfValue ?? resolvedProbability));

  return (
    <section
      className={cn(
        "space-y-3  border border-border/80 bg-background/50 p-4",
        className,
      )}
    >
      <header className="space-y-1">
        <h3 className="text-sm font-semibold">Probability Breakdown</h3>
        <p className="text-xs text-muted-foreground">
          Composite Probability: {asPercent(resolvedProbability)}
        </p>
        <p className="text-xs text-muted-foreground">
          Confidence Interval: {asPercent(ciLow)} - {asPercent(ciHigh)}
        </p>
      </header>

      <label className="block space-y-2 text-xs">
        <span className="text-muted-foreground">What-if adjustment</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={sliderValue}
          onChange={(event) => onWhatIfChange?.(Number(event.target.value))}
          className="w-full accent-primary"
          aria-label="What-if probability slider"
        />
      </label>

      <ul className="space-y-2">
        {resolvedFactors.length > 0 ? (
          resolvedFactors.map((factor, index) => (
            <FactorRow key={`${factor.name}-${index}`} factor={factor} />
          ))
        ) : (
          <li className="text-xs text-muted-foreground">No factors available.</li>
        )}
      </ul>
    </section>
  );
}

export default ProbabilityBreakdown;
