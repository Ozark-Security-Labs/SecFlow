// SPDX-License-Identifier: AGPL-3.0-only
import type {NormalizedFinding} from '../core/types.js';

export const theme = {
  brand: 'cyan',
  accent: 'blue',
  muted: 'gray',
  text: 'white',
  success: 'green',
  warning: 'yellow',
  danger: 'red',
  info: 'blue',
  border: 'gray',
  panel: 'gray'
} as const;

export function severityColor(severity: NormalizedFinding['severity']): string {
  if (severity === 'critical' || severity === 'high') return theme.danger;
  if (severity === 'medium') return theme.warning;
  if (severity === 'low') return theme.info;
  return theme.muted;
}

export function sourceLabel(source: NormalizedFinding['source']): string {
  if (source === 'business-logic') return 'BUSINESS';
  return source.toUpperCase();
}

export function sourceColor(source: NormalizedFinding['source']): string {
  if (source === 'business-logic') return theme.warning;
  if (source === 'semgrep') return theme.info;
  if (source === 'trivy') return theme.accent;
  if (source === 'joern') return theme.brand;
  return theme.muted;
}

export function statusColor(status: 'done' | 'running' | 'pending' | 'skipped' | 'error' | 'missing' | 'available'): string {
  if (status === 'done' || status === 'available') return theme.success;
  if (status === 'running') return theme.brand;
  if (status === 'skipped' || status === 'missing') return theme.warning;
  if (status === 'error') return theme.danger;
  return theme.muted;
}
