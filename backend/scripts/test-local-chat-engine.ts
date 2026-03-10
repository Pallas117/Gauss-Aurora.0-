#!/usr/bin/env node
/**
 * Test script for the local chat engine (e.g. MLX DeepSeek).
 * Uses the same OpenAI-compatible contract as gauss-orchestrator and full-stack-mission.
 * Skip when no URL is set: exit 0 and print a short message.
 */

import { checkLocalChatEngine } from "./local-chat-engine-check.js";

async function main(): Promise<void> {
  const result = await checkLocalChatEngine();

  if (result.skipped) {
    console.log("Optional: set ORCHESTRATOR_LOCAL_ENGINE_URL to test MLX DeepSeek. Skipping.");
    process.exit(0);
  }

  if (result.ok) {
    console.log("[test-local-chat-engine] OK – local chat engine responded with parseable content.");
    process.exit(0);
  }

  console.error(`[test-local-chat-engine] ${result.message}`);
  process.exit(1);
}

void main();
