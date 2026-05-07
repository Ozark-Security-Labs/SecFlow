// SPDX-License-Identifier: AGPL-3.0-only
import React, {createContext, useContext, useEffect, useState} from 'react';
import {useStdout} from 'ink';

export interface TerminalSize {
  columns: number;
  rows: number;
  compact: boolean;
  spacious: boolean;
  narrow: boolean;
}

const defaultSize = decorateSize({columns: 80, rows: 24});
const TerminalSizeContext = createContext<TerminalSize>(defaultSize);

export function TerminalSizeProvider({children}: {children: React.ReactNode}): React.ReactElement {
  const {stdout} = useStdout();
  const [size, setSize] = useState(() => readSize(stdout));

  useEffect(() => {
    const update = () => setSize(readSize(stdout));
    update();
    stdout.on?.('resize', update);
    return () => {
      stdout.off?.('resize', update);
    };
  }, [stdout]);

  return <TerminalSizeContext.Provider value={decorateSize(size)}>{children}</TerminalSizeContext.Provider>;
}

export function useTerminalSize(): TerminalSize {
  return useContext(TerminalSizeContext);
}

export function fitText(value: string, maxLength: number): string {
  if (maxLength <= 0) {
    return '';
  }
  if (value.length <= maxLength) {
    return value;
  }
  if (maxLength <= 8) {
    return value.slice(0, maxLength);
  }
  const head = Math.max(4, Math.floor((maxLength - 3) * 0.35));
  const tail = Math.max(4, maxLength - 3 - head);
  return `${value.slice(0, head)}...${value.slice(-tail)}`;
}

export function valueWidth(columns: number, labelLength = 0): number {
  return Math.max(18, columns - labelLength - 4);
}

function readSize(stdout: NodeJS.WriteStream): {columns: number; rows: number} {
  const rawColumns = Number.isFinite(stdout.columns) && stdout.columns > 0 ? stdout.columns : 80;
  return {
    // Leave one column unused so borders and fitted text do not trigger terminal auto-wrap.
    columns: Math.max(20, rawColumns - 1),
    rows: Number.isFinite(stdout.rows) && stdout.rows > 0 ? stdout.rows : 24
  };
}

function decorateSize(size: {columns: number; rows: number}): TerminalSize {
  return {
    ...size,
    compact: size.rows < 22,
    spacious: size.rows >= 28 && size.columns >= 92,
    narrow: size.columns < 92
  };
}
