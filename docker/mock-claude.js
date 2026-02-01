#!/usr/bin/env node
/**
 * Mock Claude Events
 *
 * Node.js script that outputs mock stream-json events to stdout.
 * Used for testing the full Docker → stdout → StreamEventParser → IPC → renderer pipeline.
 *
 * Environment variables:
 *   MOCK_EVENT_INTERVAL_MS - Delay between events (default: 1500)
 *   BISMARCK_TASK_ID - Task ID to include in events (default: 'mock-task')
 *
 * Usage:
 *   docker run --rm -e BISMARCK_TASK_ID=test-1 bismarck-agent-mock:test
 */

const INTERVAL_MS = parseInt(process.env.MOCK_EVENT_INTERVAL_MS || '1500', 10)
const TASK_ID = process.env.BISMARCK_TASK_ID || 'mock-task'

/**
 * Generate the mock event sequence
 */
function generateMockEventSequence(taskId) {
  const now = () => new Date().toISOString()

  return [
    // 1. System init
    {
      type: 'init',
      timestamp: now(),
      session_id: `mock-session-${taskId}`,
      model: 'claude-sonnet-4-20250514',
    },

    // 2. Assistant thinking
    {
      type: 'message',
      timestamp: now(),
      content: `I'll help with task ${taskId}. Let me start by reading the relevant files...`,
      role: 'assistant',
    },

    // 3. Read file
    {
      type: 'tool_use',
      timestamp: now(),
      tool_name: 'Read',
      tool_id: `tool-${Date.now()}-1`,
      input: { file_path: '/workspace/src/main.ts' },
    },

    // 4. Read result
    {
      type: 'tool_result',
      timestamp: now(),
      tool_id: `tool-${Date.now()}-1`,
      output:
        '// Main entry point\nimport { app } from "electron"\n\napp.whenReady().then(() => {\n  console.log("App ready")\n})',
      is_error: false,
    },

    // 5. Assistant continues
    {
      type: 'message',
      timestamp: now(),
      content: "I can see the main entry point. Now I'll make the necessary changes...",
      role: 'assistant',
    },

    // 6. Edit file
    {
      type: 'tool_use',
      timestamp: now(),
      tool_name: 'Edit',
      tool_id: `tool-${Date.now()}-2`,
      input: {
        file_path: '/workspace/src/main.ts',
        old_string: 'console.log("App ready")',
        new_string: 'console.log("App ready - Task complete!")',
      },
    },

    // 7. Edit result
    {
      type: 'tool_result',
      timestamp: now(),
      tool_id: `tool-${Date.now()}-2`,
      output: 'Successfully edited file',
      is_error: false,
    },

    // 8. Run tests
    {
      type: 'tool_use',
      timestamp: now(),
      tool_name: 'Bash',
      tool_id: `tool-${Date.now()}-3`,
      input: { command: 'npm test' },
    },

    // 9. Test result
    {
      type: 'tool_result',
      timestamp: now(),
      tool_id: `tool-${Date.now()}-3`,
      output:
        'PASS src/main.test.ts\n  ✓ app initializes correctly (15ms)\n  ✓ handles events (8ms)\n\nTest Suites: 1 passed, 1 total\nTests:       2 passed, 2 total',
      is_error: false,
    },

    // 10. Final message
    {
      type: 'message',
      timestamp: now(),
      content: "Task completed successfully. I've made the changes and all tests pass.",
      role: 'assistant',
    },

    // 11. Result
    {
      type: 'result',
      timestamp: now(),
      result: 'Task completed successfully',
      cost: {
        input_tokens: 2500,
        output_tokens: 450,
        total_cost_usd: 0.0125,
      },
      duration_ms: 15000,
      num_turns: 5,
    },
  ]
}

/**
 * Output events as NDJSON with configurable delay
 */
async function main() {
  const events = generateMockEventSequence(TASK_ID)

  // Log startup info to stderr (so it doesn't interfere with NDJSON stdout)
  console.error(`[mock-claude] Starting with TASK_ID=${TASK_ID}, INTERVAL_MS=${INTERVAL_MS}`)
  console.error(`[mock-claude] Will emit ${events.length} events`)

  for (let i = 0; i < events.length; i++) {
    const event = events[i]
    // Update timestamp to current time
    event.timestamp = new Date().toISOString()

    // Output as NDJSON (one JSON object per line)
    console.log(JSON.stringify(event))

    // Wait before next event (except after the last one)
    if (i < events.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, INTERVAL_MS))
    }
  }

  console.error('[mock-claude] All events emitted, exiting')
  process.exit(0)
}

main().catch((err) => {
  console.error('[mock-claude] Error:', err)
  process.exit(1)
})
