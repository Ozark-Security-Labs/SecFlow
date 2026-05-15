// SPDX-License-Identifier: AGPL-3.0-only
import {z} from 'zod';
import type {BusinessWorkflowModel} from '../core/types.js';

const severityValues = ['info', 'low', 'medium', 'high', 'critical'] as const;

export const workflowExtractionOutputJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'actors',
    'roles',
    'assets',
    'trustBoundaries',
    'entryPoints',
    'stateTransitions',
    'permissionChecks',
    'moneyOrDataMovement',
    'approvalFlows',
    'externalSideEffects',
    'reviewQuestions',
    'risks'
  ],
  properties: {
    actors: {type: 'array', items: {type: 'string'}},
    roles: {type: 'array', items: {type: 'string'}},
    assets: {type: 'array', items: {type: 'string'}},
    trustBoundaries: {type: 'array', items: {type: 'string'}},
    entryPoints: {type: 'array', items: {type: 'string'}},
    stateTransitions: {type: 'array', items: {type: 'string'}},
    permissionChecks: {type: 'array', items: {type: 'string'}},
    moneyOrDataMovement: {type: 'array', items: {type: 'string'}},
    approvalFlows: {type: 'array', items: {type: 'string'}},
    externalSideEffects: {type: 'array', items: {type: 'string'}},
    reviewQuestions: {type: 'array', items: {type: 'string'}},
    risks: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'severity', 'confidence', 'workflow', 'hypothesis', 'evidence', 'assumptions', 'exploitPath', 'validationSteps', 'recommendation'],
        properties: {
          title: {type: 'string'},
          severity: {type: 'string', enum: severityValues},
          confidence: {type: 'number', minimum: 0, maximum: 1},
          workflow: {type: 'string'},
          hypothesis: {type: 'string'},
          evidence: {type: 'array', items: {type: 'string'}},
          assumptions: {type: 'array', items: {type: 'string'}},
          exploitPath: {type: 'string'},
          validationSteps: {type: 'array', items: {type: 'string'}},
          recommendation: {type: 'string'}
        }
      }
    }
  }
} as const;

const workflowExtractionOutputSchema = z.object({
  actors: z.array(z.string()),
  roles: z.array(z.string()),
  assets: z.array(z.string()),
  trustBoundaries: z.array(z.string()),
  entryPoints: z.array(z.string()),
  stateTransitions: z.array(z.string()),
  permissionChecks: z.array(z.string()),
  moneyOrDataMovement: z.array(z.string()),
  approvalFlows: z.array(z.string()),
  externalSideEffects: z.array(z.string()),
  reviewQuestions: z.array(z.string()),
  risks: z.array(
    z.object({
      title: z.string().min(1),
      severity: z.enum(severityValues),
      confidence: z.number().min(0).max(1),
      workflow: z.string().min(1),
      hypothesis: z.string().min(1),
      evidence: z.array(z.string()),
      assumptions: z.array(z.string()),
      exploitPath: z.string().min(1),
      validationSteps: z.array(z.string()),
      recommendation: z.string().min(1)
    })
  )
});

export function validateWorkflowExtractionOutput(value: unknown): Omit<BusinessWorkflowModel, 'generatedAt'> {
  const parsed = workflowExtractionOutputSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(`LLM response did not match workflow-extraction schema: ${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}
