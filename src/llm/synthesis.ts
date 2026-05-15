// SPDX-License-Identifier: AGPL-3.0-only
import {z} from 'zod';

export const reportSynthesisOutputJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'findingAssessments', 'businessLogicHypotheses', 'recommendedNextSteps'],
  properties: {
    summary: {type: 'string'},
    findingAssessments: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['findingId', 'title', 'source', 'disposition', 'severity', 'confidence', 'rationale', 'evidence', 'remediation', 'validationSteps'],
        properties: {
          findingId: {type: 'string'},
          title: {type: 'string'},
          source: {type: 'string'},
          disposition: {type: 'string', enum: ['confirmed', 'likely', 'false-positive', 'needs-review']},
          severity: {type: 'string'},
          confidence: {type: 'number', minimum: 0, maximum: 1},
          rationale: {type: 'string'},
          evidence: {type: 'array', items: {type: 'string'}},
          remediation: {type: 'string'},
          validationSteps: {type: 'array', items: {type: 'string'}}
        }
      }
    },
    businessLogicHypotheses: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'assessment', 'assumptions', 'validationSteps'],
        properties: {
          title: {type: 'string'},
          assessment: {type: 'string'},
          assumptions: {type: 'array', items: {type: 'string'}},
          validationSteps: {type: 'array', items: {type: 'string'}}
        }
      }
    },
    recommendedNextSteps: {type: 'array', items: {type: 'string'}}
  }
} as const;

export const reportSynthesisOutputSchema = z.object({
  summary: z.string().min(1),
  findingAssessments: z.array(
    z.object({
      findingId: z.string().min(1),
      title: z.string().min(1),
      source: z.string().min(1),
      disposition: z.enum(['confirmed', 'likely', 'false-positive', 'needs-review']),
      severity: z.string().min(1),
      confidence: z.number().min(0).max(1),
      rationale: z.string().min(1),
      evidence: z.array(z.string()),
      remediation: z.string().min(1),
      validationSteps: z.array(z.string())
    })
  ),
  businessLogicHypotheses: z.array(
    z.object({
      title: z.string().min(1),
      assessment: z.string().min(1),
      assumptions: z.array(z.string()),
      validationSteps: z.array(z.string())
    })
  ),
  recommendedNextSteps: z.array(z.string())
});

export type ReportSynthesisOutput = z.infer<typeof reportSynthesisOutputSchema>;

export function validateReportSynthesisOutput(value: unknown): ReportSynthesisOutput {
  const parsed = reportSynthesisOutputSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(`LLM response did not match report-synthesis schema: ${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}

export function renderReportSynthesisMarkdown(output: ReportSynthesisOutput): string {
  return [
    '### Summary',
    output.summary,
    '',
    '### Finding Assessments',
    output.findingAssessments.length > 0
      ? output.findingAssessments
          .map((finding) =>
            [
              `- ${finding.title} (${finding.findingId})`,
              `  - Disposition: ${finding.disposition}; severity=${finding.severity}; confidence=${Math.round(finding.confidence * 100)}%`,
              `  - Rationale: ${finding.rationale}`,
              finding.evidence.length ? `  - Evidence: ${finding.evidence.join('; ')}` : undefined,
              `  - Remediation: ${finding.remediation}`,
              finding.validationSteps.length ? `  - Validation: ${finding.validationSteps.join('; ')}` : undefined
            ]
              .filter(Boolean)
              .join('\n')
          )
          .join('\n')
      : '- No finding assessments returned.',
    '',
    '### Business Logic Hypotheses',
    output.businessLogicHypotheses.length > 0
      ? output.businessLogicHypotheses
          .map((hypothesis) =>
            [
              `- ${hypothesis.title}`,
              `  - Assessment: ${hypothesis.assessment}`,
              hypothesis.assumptions.length ? `  - Assumptions: ${hypothesis.assumptions.join('; ')}` : undefined,
              hypothesis.validationSteps.length ? `  - Validation: ${hypothesis.validationSteps.join('; ')}` : undefined
            ]
              .filter(Boolean)
              .join('\n')
          )
          .join('\n')
      : '- No business logic hypotheses returned.',
    '',
    '### Recommended Next Steps',
    output.recommendedNextSteps.length > 0 ? output.recommendedNextSteps.map((step) => `- ${step}`).join('\n') : '- No next steps returned.'
  ].join('\n');
}
