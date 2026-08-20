import React from "react";
import { SentryCanvas } from "@/components/SentryCanvas";
import { SignUpModal } from "@/components/SignUpModal";
import { useState } from "react";

export default function Login() {
  const [signUpOpen, setSignUpOpen] = useState(false);

  return (
    <main className="min-h-screen bg-[#050505] flex flex-col items-center justify-center p-6">
      <div className="max-w-md w-full space-y-8 text-center">
        <div>
          <h1 className="text-4xl font-bold tracking-tight text-white uppercase">
            Authentication
          </h1>
          <p className="mt-2 text-sm text-white/60 font-mono">
            SEC-COM LEVEL 4 // OPERATOR VERIFICATION
          </p>
        </div>

        <div className="flex justify-center py-8">
          <SentryCanvas />
        </div>

        <div className="space-y-4">
          <button
            onClick={() => setSignUpOpen(true)}
            className="w-full bg-[#CCFF00] text-black font-black py-4 rounded-xl uppercase tracking-widest hover:opacity-90 transition-opacity"
          >
            Access Mission Control
          </button>
          
          <p className="text-xs text-white/40 font-mono">
            Awaiting hardware fingerprint and operator credentials.
          </p>
        </div>
      </div>

      <SignUpModal 
        open={signUpOpen} 
        onOpenChange={setSignUpOpen} 
      />
    </main>
  );
}
