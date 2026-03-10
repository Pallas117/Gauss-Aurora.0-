/**
 * Partner onboarding wizard: Add device (Turing) then Choose plan.
 */

import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { JoinNetworkOnboarding } from "@/components/onboarding/JoinNetworkOnboarding";
import { PlanSelector } from "@/components/onboarding/PlanSelector";
import { useOnboarding } from "@/hooks/useOnboarding";
import { Loader2, Server } from "lucide-react";

const defaultLandingSda =
  String(
    (import.meta.env?.VITE_DEFAULT_LANDING ??
      (typeof process !== "undefined" ? process.env?.VITE_DEFAULT_LANDING : undefined) ??
      ""
    ).toLowerCase()
  ) === "sda";

export default function OnboardingPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const onboarding = useOnboarding();
  const [step, setStep] = useState<1 | 2>(1);

  useEffect(() => {
    if (onboarding.loading) return;
    if (onboarding.completed) {
      navigate(defaultLandingSda ? "/sda" : "/heliophysics", { replace: true });
      return;
    }
    if (onboarding.deviceStepDone && step === 1) {
      setStep(2);
    }
  }, [onboarding.loading, onboarding.completed, onboarding.deviceStepDone, step, navigate]);

  const successHandled = useRef(false);
  useEffect(() => {
    if (searchParams.get("success") !== "1" || onboarding.loading || successHandled.current) return;
    successHandled.current = true;
    void onboarding.setPlanStepDone(true).then(() => {
      void onboarding.complete().then(() => {
        navigate(defaultLandingSda ? "/sda" : "/heliophysics", { replace: true });
      });
    });
  }, [searchParams, onboarding.loading, onboarding, navigate]);

  const handleDeviceDone = async () => {
    await onboarding.setDeviceStepDone(true);
    setStep(2);
  };

  const handleDeviceSkip = async () => {
    await onboarding.setDeviceStepDone(true);
    setStep(2);
  };

  const handlePlanComplete = async () => {
    await onboarding.setPlanStepDone(true);
    await onboarding.complete();
    navigate(defaultLandingSda ? "/sda" : "/heliophysics", { replace: true });
  };

  const handlePlanSkip = async () => {
    await onboarding.setPlanStepDone(true);
    await onboarding.complete();
    navigate(defaultLandingSda ? "/sda" : "/heliophysics", { replace: true });
  };

  if (onboarding.loading) {
    return (
      <main className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </main>
    );
  }

  if (onboarding.completed) {
    return null;
  }

  return (
    <main className="min-h-screen bg-background p-6 md:p-10">
      <div className="mx-auto max-w-2xl space-y-8">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Partner onboarding</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Add your device as compute and choose a plan to access the mission console.
          </p>
        </div>

        {step === 1 && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Server className="h-4 w-4" />
                Step 1: Add your device as hardware compute
              </CardTitle>
              <CardDescription>
                Join a device to the Turing network for cache and compute. You can skip and do this later from Systems.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <JoinNetworkOnboarding
                variant="full"
                showGenerateCode={true}
                showTuringLink={true}
              />
              <div className="flex flex-wrap gap-2 pt-4 border-t border-border">
                <Button onClick={() => void handleDeviceDone()}>
                  I&apos;ve added a device
                </Button>
                <Button variant="outline" onClick={() => void handleDeviceSkip()}>
                  Skip for now
                </Button>
              </div>
              {onboarding.error && (
                <p className="text-destructive text-sm">{onboarding.error}</p>
              )}
            </CardContent>
          </Card>
        )}

        {step === 2 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Step 2: Choose your plan</CardTitle>
              <CardDescription>
                Subscribe as a partner. Student and young professional from $5; operator plans from $1500–$5000/month. 90-day pilots available.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <PlanSelector
                onComplete={handlePlanComplete}
                onSkip={handlePlanSkip}
              />
              {onboarding.error && (
                <p className="text-destructive text-sm">{onboarding.error}</p>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </main>
  );
}
