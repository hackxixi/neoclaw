/**
 * Session transcript summarizer.
 *
 * Uses claude CLI in --print mode (single-shot, no persistent process)
 * to generate a structured summary from conversation history.
 */

import { loadConfig } from '../config.js';

const DEFAULT_SUMMARY_TIMEOUT_SECS = 300;

/** Model priority: explicit override > config.agent.summaryModel > ANTHROPIC_SMALL_FAST_MODEL > haiku default. */
function getSummaryModel(explicitModel?: string): string {
  if (explicitModel) return explicitModel;
  try {
    const config = loadConfig();
    if (config.agent.summaryModel) return config.agent.summaryModel;
  } catch {
    /* ignore */
  }
  return 'haiku';
}

function getSummaryTimeoutMs(): number {
  try {
    const config = loadConfig();
    const secs = config.agent.summaryTimeoutSecs ?? DEFAULT_SUMMARY_TIMEOUT_SECS;
    return Math.max(1, secs) * 1000;
  } catch {
    return DEFAULT_SUMMARY_TIMEOUT_SECS * 1000;
  }
}

export interface SessionSummary {
  title: string;
  summary: string;
  topics: string[];
  decisions: string[];
}

const SUMMARIZE_PROMPT = `You are a conversation summarizer. Analyze the following transcript and produce a structured summary.

Output EXACTLY in this format (no extra text before or after):
---
title: "<concise title describing the main topic>"
date: "<YYYY-MM-DD>"
tags: [<comma-separated relevant tags>]
---

## Summary
<2-4 sentence summary of the conversation>

## Key Topics
- <topic 1>
- <topic 2>

## Decisions & Outcomes
- <decision or outcome 1>
- <decision or outcome 2>

## Notable Information
- <any important facts, preferences, or context worth remembering>

Transcript:
`;

export async function summarizeTranscript(
  transcript: string,
  opts?: { model?: string }
): Promise<string> {
  const model = getSummaryModel(opts?.model);
  const timeoutMs = getSummaryTimeoutMs();
  const prompt = SUMMARIZE_PROMPT + transcript;
  const env = { ...process.env };
  delete env['CLAUDECODE'];
  delete env['CLAUDE_CODE_ENTRYPOINT'];

  const proc = Bun.spawn(['claude', '--model', model, '-p', prompt], {
    stdout: 'pipe',
    stderr: 'pipe',
    env,
  });

  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    if (!proc.killed) proc.kill();
  }, timeoutMs);

  const [exitCode, stdout, stderr] = await Promise.all([
    proc.exited,
    proc.stdout ? new Response(proc.stdout).text() : Promise.resolve(''),
    proc.stderr ? new Response(proc.stderr).text() : Promise.resolve(''),
  ]);

  clearTimeout(timeout);

  if (timedOut) {
    throw new Error(`Claude CLI timed out after ${Math.round(timeoutMs / 1000)}s`);
  }

  if (exitCode !== 0) {
    throw new Error(`Claude CLI failed (exit ${exitCode}): ${stderr.trim()}`);
  }

  return stdout.trim();
}
