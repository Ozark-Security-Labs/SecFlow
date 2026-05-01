import type {BusinessWorkflowModel, NormalizedFinding, ToolRunResult} from './types.js';

export function findingsFromBusinessModel(model: BusinessWorkflowModel): NormalizedFinding[] {
  return model.risks.map((risk, index) => ({
    id: `business-logic:${index}:${slugify(risk.title)}`,
    source: 'business-logic',
    title: risk.title,
    severity: risk.severity,
    confidence: risk.confidence,
    description: risk.hypothesis,
    evidence: risk.evidence,
    recommendation: risk.validationSteps.join(' '),
    metadata: {
      workflow: risk.workflow,
      validationSteps: risk.validationSteps
    }
  }));
}

export function collectFindings(toolResults: ToolRunResult[], businessModel: BusinessWorkflowModel): NormalizedFinding[] {
  const findings = [...toolResults.flatMap((result) => result.findings), ...findingsFromBusinessModel(businessModel)];
  const seen = new Set<string>();
  return findings.filter((finding) => {
    if (seen.has(finding.id)) {
      return false;
    }
    seen.add(finding.id);
    return true;
  });
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}
