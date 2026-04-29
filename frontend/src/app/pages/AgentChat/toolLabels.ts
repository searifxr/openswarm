// Friendly verb-tense labels for tool calls. Replaces the raw tool name in
// ToolCallBubble titles so the transcript reads as a narration of what the
// agent is doing — "Reading foo.ts" while pending, "Read foo.ts" once done.
//
// Falls back to the raw tool name (capitalized) for anything unmapped, so
// new tools won't render badly. MCP tools (mcp__server__action) are handled
// in ToolCallBubble's existing parseMcpToolName path; this map is for
// built-ins.
//
// Tense convention:
//   - present: "-ing" form rendered while the call is pending
//   - past:    rendered once a tool_result lands (success or error)
//
// Usage:
//   const { present, past } = getToolLabel(toolName);
//   const verb = isPending ? present : past;

interface ToolLabel {
  present: string;
  past: string;
}

const LABELS: Record<string, ToolLabel> = {
  read: { present: 'Reading', past: 'Read' },
  write: { present: 'Writing', past: 'Wrote' },
  edit: { present: 'Editing', past: 'Edited' },
  multiedit: { present: 'Editing', past: 'Edited' },
  strreplace: { present: 'Editing', past: 'Edited' },
  bash: { present: 'Running', past: 'Ran' },
  glob: { present: 'Searching', past: 'Searched' },
  grep: { present: 'Searching', past: 'Searched' },
  ripgrep: { present: 'Searching', past: 'Searched' },
  ls: { present: 'Listing', past: 'Listed' },
  websearch: { present: 'Searching the web', past: 'Searched the web' },
  webfetch: { present: 'Fetching', past: 'Fetched' },
  notebookedit: { present: 'Editing notebook', past: 'Edited notebook' },
  todowrite: { present: 'Updating todos', past: 'Updated todos' },
  todoread: { present: 'Reading todos', past: 'Read todos' },
  taskcreate: { present: 'Creating task', past: 'Created task' },
  taskupdate: { present: 'Updating task', past: 'Updated task' },
  taskoutput: { present: 'Inspecting task', past: 'Inspected task' },
  taskstop: { present: 'Stopping task', past: 'Stopped task' },
  tasklist: { present: 'Listing tasks', past: 'Listed tasks' },
  taskget: { present: 'Loading task', past: 'Loaded task' },
  toolsearch: { present: 'Loading tools', past: 'Loaded tools' },
  mcpsearch: { present: 'Searching MCPs', past: 'Searched MCPs' },
  mcpactivate: { present: 'Activating MCP', past: 'Activated MCP' },
  outputactivate: { present: 'Activating view', past: 'Activated view' },
  renderoutput: { present: 'Rendering view', past: 'Rendered view' },
  askuserquestion: { present: 'Asking', past: 'Asked' },
  invokeagent: { present: 'Invoking sub-agent', past: 'Invoked sub-agent' },
  agent: { present: 'Spawning agent', past: 'Spawned agent' },
  enterplanmode: { present: 'Entering plan mode', past: 'Entered plan mode' },
  exitplanmode: { present: 'Exiting plan mode', past: 'Exited plan mode' },
  enterworktree: { present: 'Creating worktree', past: 'Created worktree' },
  exitworktree: { present: 'Removing worktree', past: 'Removed worktree' },
  pushnotification: { present: 'Notifying', past: 'Notified' },
  remotetrigger: { present: 'Triggering', past: 'Triggered' },
  croncreate: { present: 'Scheduling', past: 'Scheduled' },
  cronlist: { present: 'Listing schedules', past: 'Listed schedules' },
  crondelete: { present: 'Cancelling schedule', past: 'Cancelled schedule' },
  monitor: { present: 'Watching', past: 'Watched' },
  schedulewakeup: { present: 'Scheduling wake-up', past: 'Scheduled wake-up' },
};

export function getToolLabel(toolName: string): ToolLabel {
  if (!toolName) return { present: 'Working', past: 'Done' };
  const key = toolName.toLowerCase();
  const hit = LABELS[key];
  if (hit) return hit;
  // Fallback: capitalize the raw name with neutral verbs that read OK either
  // way ("Running tool" / "Ran tool").
  const pretty = toolName.charAt(0).toUpperCase() + toolName.slice(1);
  return { present: `Running ${pretty}`, past: `Ran ${pretty}` };
}
