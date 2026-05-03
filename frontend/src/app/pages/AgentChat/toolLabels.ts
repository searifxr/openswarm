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

// Brand names for MCP servers — what we want users to *see* instead of
// the kebab-case server id. Keyed by the sanitized server name (matches
// _sanitize_server_name in tools_lib).
const MCP_SERVER_BRAND: Record<string, string> = {
  'google-workspace': 'Google Workspace',
  'microsoft-365': 'Microsoft 365',
  'gmail': 'Gmail',
  'gcal': 'Google Calendar',
  'gdrive': 'Google Drive',
  'gdocs': 'Google Docs',
  'gsheets': 'Google Sheets',
  'gslides': 'Google Slides',
  'slack': 'Slack',
  'discord': 'Discord',
  'notion': 'Notion',
  'airtable': 'Airtable',
  'hubspot': 'HubSpot',
  'reddit': 'Reddit',
  'youtube': 'YouTube',
  'github': 'GitHub',
  'linear': 'Linear',
  'jira': 'Jira',
  'asana': 'Asana',
  'figma': 'Figma',
  'stripe': 'Stripe',
};

// Verb derivation from MCP sub-tool action names. The action is
// everything after `mcp__server__`. We split on common verb prefixes
// so a 100-tool catalog renders as a handful of verb categories the
// user can actually parse. Matched in declaration order — first hit wins.
const MCP_VERB_PATTERNS: Array<{ match: RegExp; present: string; past: string }> = [
  { match: /^(send|create|post|publish|new)_/, present: 'Sending', past: 'Sent' },
  { match: /^(query|search|find|list|get|fetch|read|view|show)_/, present: 'Reading', past: 'Read' },
  { match: /^(update|edit|modify|patch|set)_/, present: 'Updating', past: 'Updated' },
  { match: /^(delete|remove|cancel|archive)_/, present: 'Deleting', past: 'Deleted' },
  { match: /^(reply|respond|comment)_/, present: 'Replying', past: 'Replied' },
  { match: /^(download|export|backup)_/, present: 'Downloading', past: 'Downloaded' },
  { match: /^(upload|import|attach)_/, present: 'Uploading', past: 'Uploaded' },
  { match: /^(execute|run|invoke|trigger)_/, present: 'Running', past: 'Ran' },
];

// Object hint extracted from the action name's tail — e.g.
// "query_gmail_emails" → "emails", "send_slack_message" → "message".
// Used to flesh out the verb ("Reading emails" instead of just "Reading").
function _objectHint(action: string): string {
  const cleaned = action.replace(/^(send|create|post|publish|new|query|search|find|list|get|fetch|read|view|show|update|edit|modify|patch|set|delete|remove|cancel|archive|reply|respond|comment|download|export|backup|upload|import|attach|execute|run|invoke|trigger)_/, '');
  // Strip per-server stems that are redundant (e.g. "gmail_emails" → "emails")
  const segments = cleaned.split(/[_-]+/).filter(Boolean);
  if (!segments.length) return '';
  // Keep the last 1-2 segments — usually the noun.
  const tail = segments.slice(-2).join(' ');
  return tail.replace(/_/g, ' ');
}

// Parse an mcp__<server>__<action> tool name into a friendly label.
// Returns null when the input isn't an MCP-shaped tool name; callers
// fall through to the builtin LABELS map.
function _labelForMcpTool(toolName: string): ToolLabel | null {
  // Server names can contain dashes — split on `__` only.
  const parts = toolName.split('__');
  if (parts.length < 3 || parts[0] !== 'mcp') return null;
  const server = parts[1].toLowerCase();
  const action = parts.slice(2).join('__');
  const brand = MCP_SERVER_BRAND[server] || _humanizeName(server);
  // Try verb pattern match first.
  for (const p of MCP_VERB_PATTERNS) {
    if (p.match.test(action)) {
      const obj = _objectHint(action);
      const tail = obj ? ` ${brand} ${obj}` : ` from ${brand}`;
      return {
        present: `${p.present}${tail}`,
        past: `${p.past}${tail}`,
      };
    }
  }
  // Fallback: humanize the action and pair with the brand.
  const human = _humanizeName(action);
  return {
    present: `${brand}: ${human}`,
    past: `${brand}: ${human}`,
  };
}

function _humanizeName(name: string): string {
  return name
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function getToolLabel(toolName: string): ToolLabel {
  if (!toolName) return { present: 'Working', past: 'Done' };
  // MCP sub-tools come in as `mcp__<server>__<action>` — resolve them
  // through the brand + verb-pattern derivation before hitting LABELS.
  const mcpHit = _labelForMcpTool(toolName);
  if (mcpHit) return mcpHit;
  const key = toolName.toLowerCase();
  const hit = LABELS[key];
  if (hit) return hit;
  // Fallback: capitalize the raw name with neutral verbs that read OK either
  // way ("Running tool" / "Ran tool").
  const pretty = toolName.charAt(0).toUpperCase() + toolName.slice(1);
  return { present: `Running ${pretty}`, past: `Ran ${pretty}` };
}
