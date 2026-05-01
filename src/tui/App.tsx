import React from 'react';
import {Box, Text} from 'ink';

export interface AppProps {
  cwd: string;
}

export function App({cwd}: AppProps): React.ReactElement {
  return (
    <Box flexDirection="column" padding={1}>
      <Text bold color="cyan">
        SecFlow
      </Text>
      <Text>Application security LLM harness for repository profiling, deterministic scanners, and business logic analysis.</Text>
      <Text>Workspace: {cwd}</Text>
      <Box marginTop={1} flexDirection="column">
        <Text color="green">Useful commands</Text>
        <Text>secflow init</Text>
        <Text>secflow audit . --approve-context</Text>
        <Text>secflow tools doctor</Text>
        <Text>secflow models list</Text>
        <Text>secflow playbooks validate playbooks/default-audit.yaml</Text>
      </Box>
    </Box>
  );
}
