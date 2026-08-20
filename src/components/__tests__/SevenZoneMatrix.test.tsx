import { render, screen } from "@testing-library/react";
import { SevenZoneMatrix } from "@/components/sda/SevenZoneMatrix";
import type { SevenZoneAssessment } from "@/lib/types/seven-zone";

const assessment: SevenZoneAssessment = {
  schema: "gauss-seven-zone-v1",
  assessmentId: "test-assessment",
  generatedAt: "2026-08-19T00:00:00.000Z",
  missionId: "public-space-domain",
  deploymentScope: "ground_only",
  mode: "environmental_screening",
  qualificationEvidence: false,
  aggregateState: "unknown",
  decision: "unknown",
  blockers: ["space_domain_ingest_empty"],
  limitations: ["Environmental screening is not a dose, damage, or failure probability."],
  zones: ["A", "B", "C", "D", "E", "F", "G"].map((id) => ({
    id: id as SevenZoneAssessment["zones"][number]["id"],
    name: id,
    applicability: id === "B" ? "not_applicable" : "required",
    state: id === "A" ? "blocked" : "unknown",
    evidence: [],
    reasons: [],
    blockers: [],
  })),
};

test("communicates blocked and unknown states without qualification language", () => {
  render(<SevenZoneMatrix assessment={assessment} loading={false} error={null} />);
  expect(screen.getByText("Seven-zone advisory")).toBeInTheDocument();
  expect(screen.getByLabelText("A blocked")).toBeInTheDocument();
  expect(screen.getByText(/environmental screening · read-only · no qualification claim/i)).toBeInTheDocument();
  expect(screen.getByText(/blockers: space_domain_ingest_empty/i)).toBeInTheDocument();
});
