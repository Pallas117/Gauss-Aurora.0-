# Probability Models and Pre-Inference Gating (Gauss RAG)

This document describes the probability models and gating used in the Gauss stack so the co-pilot can reason consistently with them.

## Threat types

The system uses a fixed set of threat types: **collision**, **solar_flare**, **cyber**, **debris**, **radiation**, **anomaly**. Assessments combine factors (name, weight, value, contribution) into a probability and a confidence interval.

## 3-sigma and probability gating

- The **heavy LLM (DeepSeek-R1)** must remain dormant under normal conditions. Telemetry first passes through lightweight mathematical filters (e.g. Bayesian-style probability or standard deviation thresholds).
- **Only wake the LLM if the anomaly exceeds 3-sigma** (or configured urgency threshold). Otherwise the system logs and sleeps (LOG_AND_SLEEP) rather than triggering inference (TRIGGER_LLM).
- The pre-inference gate uses a flux proxy derived from space weather (Bz, Kp, coupling, solar wind speed/density). Urgency is evaluated via normal CDF; when likelihood exceeds a threshold (e.g. 0.85), the gate allows LLM invocation.

## Confidence intervals and fusion

- Each threat assessment includes a **confidence_interval** (e.g. [0.8, 0.9] for 80–90% bounds). Recommendations should cite these when present.
- **Probability fusion** combines orbital telemetry, space track, solar/debris external data into a unified threat score. Factors contribute by weight; composite score and recommended_action are produced for actionable threats.
- When outputting JSON recommendations (e.g. AgenticRecommendation), include **probability**, **confidence_interval**, **recommended_action**, and optional **factors** with contribution values for causality.
