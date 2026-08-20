# Gaussian Hypothesis Cycle

## Purpose
This is Gauss's bounded local learning method for problems that are not solved by deterministic rules alone.

It is not freeform chain-of-thought. It is a controlled cycle:
1. retrieve grounded evidence from approved local RAG documents
2. form a small set of competing hypotheses
3. assign explicit priors and competing likelihoods
4. compute the posterior in code with Bayes' rule
5. choose the smallest safe observation, replay, or simulation that can change the posterior materially

## Why this method
Flight systems survive by refusing to guess. When evidence is incomplete, the correct move is not invention; it is bounded experimentation and conservative update.

This matches the engineering style of long-lived missions:
- deterministic nominal path
- minimal always-on health core
- safe-mode before collapse
- cached and bounded state
- reprogrammable but constrained autonomy

## Required output structure
Each hypothesis must include:
- `statement`
- `prior`
- `likelihood_if_true`
- `likelihood_if_false`
- `evidence_refs`
- `required_signals`
- `math_check`
- `safe_experiment`

The model may propose the hypothesis set, but the posterior is computed outside the model.

## Posterior update
For one hypothesis:

`prior_odds = prior / (1 - prior)`

`likelihood_ratio = likelihood_if_true / likelihood_if_false`

`posterior_odds = prior_odds * likelihood_ratio`

`posterior = posterior_odds / (1 + posterior_odds)`

This keeps the update auditable and resistant to model overconfidence.

## Safe experiment policy
Allowed experiment classes:
- observe
- replay
- simulate

Not allowed:
- destructive actions
- covert persistence
- risky intervention used only to gather evidence

If evidence is too weak:
- say so plainly
- keep the verdict at `need-more-data`
- recommend the smallest safe next observation

## Gauss doctrine
- truth only
- zero tolerance for hallucination
- uncertainty means more evidence, not guesswork
- mathematics ranks the hypotheses
- reversible experiments come before commitment
