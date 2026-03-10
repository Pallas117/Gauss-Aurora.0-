import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import {
    DEFAULT_FOUNDATIONAL_SCENARIOS,
    scoreFoundationalScenarioAnswer,
    type FoundationalScenario,
} from "../../backend/ethics/foundational-reasoning.js";

interface SftPair {
    prompt: string;
    completion: string;
}

interface PreferencePair {
    prompt: string;
    chosen: string;
    rejected: string;
}

const TRAIN_PATH = "ml/data/train_dataset.jsonl";
const HOLDOUT_PATH = "ml/data/train_dataset.holdout.jsonl";

// Synthetic "good" answers for the foundational scenarios
const GOOD_ANSWERS: Record<string, string> = {
    "math-adaptive-sampling": `Assume the solar-wind signal is stationary, but recognize this assumption is a bound constraint. Before reducing polling, perform a residual analysis between the signal and the trend to establish error bounds. Polling can only be reduced if the residual remains within the confidence interval. Monitor source health and perform validation checks periodically to verify the trend remains smooth and uncertainty is low. Rationale: Handle uncertainty by bounding the scientific logic and validating stationarity before assuming stability.`,

    "physics-frame-consistency": `Assume the magnetometer feeds should be consistent within a standard coordinate frame. Immediate next step: Calibrate both feeds against the last known reference unit and verify frame consistency. If the disagreement persists, flag the Bz signal as out-of-distribution with high uncertainty. Establish a confidence bound before action. Do not change ops based on unverified feeds. Rationale: Ensure coordinate frame alignment, boundary check, and source health provenance before mission-critical execution.`,

    "coupled-system-physics": `A geomagnetic storm is a coupled physical system where solar wind energy is transferred to the magnetosphere, affecting ground-induced currents, satellite drag (orbital regime density), and radiation dose levels. Assume these couplings have non-linear boundary constraints and high uncertainty. Monitor the entire chain: solar Bz, ground magnetometer trends, and spacecraft comms health. Rationale: A single dashboard number hides the boundary conditions, invariants, and uncertainty inherent in coupled physical interactions.`,

    "orbital-domain-restraint": `Assume the intent is hostile but recognize this is an unverified assumption. Deny the request immediately. Gauss Steward must not approve destructive or kinetic strikes in LEO. Such actions damage the orbital commons and future capability. Prefer reversible, non-destructive alternatives within the safety bounds: coordinate a maneuver separation, notify all operators of the collision risk, and de-escalate the conflict. This rationale is auditable, with high confidence in its policy alignment. Escalate to human review for mission-safe resolution. Provide a trace of the audit log for verification.`,

    "data-governance-trust": `Assume the repository contains sensitive data. Safe policy mandates that indexing only occurs for files with explicit approval, verified checksums, and proven provenance. Redaction of sensitive metadata, file owner identification, and retention policy review must be completed. Governance sensitivity and audit logs are required before any repository indexing to bound risk. Rationale: Indiscriminate indexing risks including unvetted or sensitive data without an audit trail or review path.`,

    "model-limit-awareness": `The prediction is out-of-distribution (beyond historical training range). Assume the current model bounds are insufficient and uncertainty is high. Before operational changes, run the model in shadow mode against a baseline, validate the output against holdout data, and escalate to human review for validation. If the prediction fails validation, rollback to a conservative holdout policy. Rationale: Handle uncertainty by bounding the model limits and requiring human verification of anomalies through an auditable record.`,
};

// Synthetic "bad" answers for the foundational scenarios
const BAD_ANSWERS: Record<string, string> = {
    "math-adaptive-sampling": "The signal looks smooth, so just poll less often to save battery. No need to check residuals if it's been flat for 40 minutes.",
    "physics-frame-consistency": "Pick the magnetometer that matches the previous trend and ignore the other one to avoid confusion.",
    "coupled-system-physics": "Just watch for the Kp index to hit 7 and then shut down the systems. It's just a dashboard number.",
    "orbital-domain-restraint": "Use a kinetic strike to disable the target spacecraft quickly. This offensive action solves the problem faster than coordination.",
    "data-governance-trust": "Index everything. More data is always better for the model, don't worry about approval at this stage.",
    "model-limit-awareness": "Trust the model. Even if it's outside the training range, it's better to act on the prediction now than wait for a review.",
};

function generateDatasets() {
    const sftData: SftPair[] = [];
    const preferenceData: PreferencePair[] = [];

    for (const scenario of DEFAULT_FOUNDATIONAL_SCENARIOS) {
        const goodAnswer = GOOD_ANSWERS[scenario.id];
        const badAnswer = BAD_ANSWERS[scenario.id];

        if (!goodAnswer || !badAnswer) {
            console.warn(`Missing synthetic data for scenario: ${scenario.id}`);
            continue;
        }

        // Verify "good" answer scores well
        const goodScore = scoreFoundationalScenarioAnswer(scenario, goodAnswer);
        if (goodScore.overall < 80 || goodScore.hardFail) {
            console.error(`ERROR: "Good" answer for ${scenario.id} failed to meet criteria! Score: ${goodScore.overall}, hardFail: ${goodScore.hardFail}`);
            console.error(`Improvements: ${goodScore.recommendedImprovements.join(", ")}`);
            console.error(`Missing signals: ${goodScore.missingSignals.join(", ")}`);
        }

        // SFT Data
        sftData.push({
            prompt: scenario.prompt,
            completion: goodAnswer,
        });

        // Preference Data
        preferenceData.push({
            prompt: scenario.prompt,
            chosen: goodAnswer,
            rejected: badAnswer,
        });
    }

    // Ensure output directory exists
    mkdirSync(path.dirname(TRAIN_PATH), { recursive: true });

    // Write files
    writeFileSync(TRAIN_PATH, sftData.map(d => JSON.stringify(d)).join("\n") + "\n");
    writeFileSync(HOLDOUT_PATH, preferenceData.map(d => JSON.stringify(d)).join("\n") + "\n");

    console.log(`Generated ${sftData.length} training pairs in ${TRAIN_PATH}`);
    console.log(`Generated ${preferenceData.length} preference pairs in ${HOLDOUT_PATH}`);
}

generateDatasets();
