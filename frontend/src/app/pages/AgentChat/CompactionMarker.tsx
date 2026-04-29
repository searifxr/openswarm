import React from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import UnfoldLessOutlinedIcon from '@mui/icons-material/UnfoldLessOutlined';
import { useClaudeTokens } from '@/shared/styles/ThemeContext';

// Inline marker rendered immediately after the message identified by
// `compacted_through_msg_id`. The auto-compaction routine summarizes older
// turns into a single block; without a visible cue, the transcript would
// just appear to "skip" — users assume the agent forgot something. The chip
// makes it clear the older turns are still in scope, just collapsed.
//
// Click is currently a no-op (we don't surface the summary text yet); the
// affordance reads as "hover for info" via the cursor style only. If we
// later persist the summary text in the session, expand-to-reveal lands
// here.
const CompactionMarker: React.FC<{ collapsedCount: number }> = ({ collapsedCount }) => {
  const c = useClaudeTokens();
  const label = collapsedCount > 0
    ? `${collapsedCount} earlier turn${collapsedCount === 1 ? '' : 's'} summarized`
    : 'Older turns summarized';
  return (
    <Box sx={{ display: 'flex', justifyContent: 'center', my: 1.25 }}>
      <Box
        sx={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 0.625,
          px: 1.25,
          py: 0.4,
          borderRadius: 9999,
          bgcolor: c.bg.secondary,
          border: `1px solid ${c.border.subtle}`,
          color: c.text.muted,
          cursor: 'default',
          userSelect: 'none',
        }}
      >
        <UnfoldLessOutlinedIcon sx={{ fontSize: 13, opacity: 0.7 }} />
        <Typography sx={{ fontSize: '0.7rem', lineHeight: 1, fontWeight: 500 }}>
          {label}
        </Typography>
      </Box>
    </Box>
  );
};

export default CompactionMarker;
