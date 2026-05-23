_READ_PREFIXES = ("get", "list", "read", "search", "fetch", "find", "query", "count", "check", "describe", "show", "download", "browse", "analy", "explain")
_WRITE_PREFIXES = ("create", "write", "delete", "update", "send", "remove", "modify", "add", "set", "put", "post", "patch", "insert", "move", "copy", "rename", "archive", "trash", "publish", "approve", "reject")


_SERVICE_RULES: list[tuple[list[str], str, str]] = [
    # (keywords, service_name, group)
    # Google Workspace
    (["gmail"], "Gmail", "Google"),
    (["drive"], "Drive", "Google"),
    (["calendar", "event", "freebusy"], "Calendar", "Google"),
    (["spreadsheet", "sheet"], "Sheets", "Google"),
    (["doc", "paragraph", "table"], "Docs", "Google"),
    (["chat", "space", "reaction", "message"], "Chat", "Google"),
    (["form", "publish_settings"], "Forms", "Google"),
    (["presentation", "slide", "page"], "Slides", "Google"),
    (["task_list", "task"], "Tasks", "Google"),
    (["contact"], "Contacts", "Google"),
    (["script", "deployment", "version", "trigger"], "Apps Script", "Google"),
    (["search_custom", "search_engine"], "Search", "Google"),
    # YouTube
    (["transcript", "caption"], "Transcripts", "YouTube"),
    (["video_detail", "video_comment", "video_categor", "video_engagement"], "Videos", "YouTube"),
    (["search_video", "trending_video"], "Search", "YouTube"),
    (["channel_stat", "channel_top"], "Channels", "YouTube"),
    # Reddit (before Twitter so "search_reddit" etc. don't mis-match)
    (["subreddit"], "Subreddits", "Reddit"),
    (["search_reddit"], "Search", "Reddit"),
    (["post_detail"], "Posts", "Reddit"),
    (["user_analysis"], "Users", "Reddit"),
    (["reddit_explain"], "Reference", "Reddit"),
]


def _categorize_tool(name: str) -> str:
    lower = name.lower().replace("_", " ").replace("-", " ").strip()
    for word in lower.split():
        for prefix in _READ_PREFIXES:
            if word.startswith(prefix):
                return "read"
        for prefix in _WRITE_PREFIXES:
            if word.startswith(prefix):
                return "write"
    return "write"


def _extract_service(name: str) -> tuple[str, str]:
    """Extract the service and group from a tool name (e.g. 'search_gmail_messages' -> ('Gmail', 'Google'))."""
    lower = name.lower()
    for keywords, display, group in _SERVICE_RULES:
        for kw in keywords:
            if kw in lower:
                return display, group
    return "Other", ""
