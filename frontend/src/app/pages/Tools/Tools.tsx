import React, { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import TextField from '@mui/material/TextField';
import MenuItem from '@mui/material/MenuItem';
import Select from '@mui/material/Select';
import FormControl from '@mui/material/FormControl';
import InputLabel from '@mui/material/InputLabel';
import IconButton from '@mui/material/IconButton';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import Tooltip from '@mui/material/Tooltip';
import Collapse from '@mui/material/Collapse';
import Menu from '@mui/material/Menu';
import Snackbar from '@mui/material/Snackbar';
import Alert from '@mui/material/Alert';
import InputAdornment from '@mui/material/InputAdornment';
import Avatar from '@mui/material/Avatar';
import Switch from '@mui/material/Switch';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import TerminalIcon from '@mui/icons-material/Terminal';
import BuildIcon from '@mui/icons-material/Build';
import ExtensionIcon from '@mui/icons-material/Extension';
import DescriptionIcon from '@mui/icons-material/Description';
import SearchIcon from '@mui/icons-material/Search';
import QuestionAnswerIcon from '@mui/icons-material/QuestionAnswer';
import LockIcon from '@mui/icons-material/Lock';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import KeyboardArrowRightIcon from '@mui/icons-material/KeyboardArrowRight';
import ScheduleIcon from '@mui/icons-material/Schedule';
import MapIcon from '@mui/icons-material/Map';
import HourglassEmptyIcon from '@mui/icons-material/HourglassEmpty';
import StorefrontIcon from '@mui/icons-material/Storefront';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import DownloadIcon from '@mui/icons-material/Download';
import StarIcon from '@mui/icons-material/Star';
import SortIcon from '@mui/icons-material/Sort';
import CloudIcon from '@mui/icons-material/Cloud';
import PublicIcon from '@mui/icons-material/Public';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import { useAppDispatch, useAppSelector } from '@/shared/hooks';
import LinkIcon from '@mui/icons-material/Link';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import SettingsIcon from '@mui/icons-material/Settings';
import BlockIcon from '@mui/icons-material/Block';
import VisibilityIcon from '@mui/icons-material/Visibility';
import SecurityIcon from '@mui/icons-material/Security';
import PanToolIcon from '@mui/icons-material/PanTool';
import CallSplitIcon from '@mui/icons-material/CallSplit';
import RefreshIcon from '@mui/icons-material/Refresh';
import {
  fetchTools,
  fetchBuiltinTools,
  fetchBuiltinPermissions,
  updateBuiltinPermissions,
  createTool,
  updateTool,
  deleteTool,
  startOAuth,
  fetchToolStatus,
  discoverTools,
  startDeviceCodeLogin,
  pollDeviceCodeStatus,
  disconnectM365,
  ToolDefinition,
  BuiltinTool,
} from '@/shared/state/toolsSlice';
import {
  searchRegistry,
  fetchRegistryStats,
  fetchServerDetail,
  clearDetail,
  McpServer,
} from '@/shared/state/mcpRegistrySlice';
import { Skeleton } from '@/app/components/Loading';

import { useClaudeTokens } from '@/shared/styles/ThemeContext';
import { API_BASE } from '@/shared/config';
import { Integration, INTEGRATIONS } from './integrations';
import { CATEGORY_ORDER, ToolForm, emptyForm, cleanServerName, serverToToolForm, serverToMcpConfig } from './toolsHelpers';
import ToolSection from './ToolSection';
import BrowserPermissionCard from './BrowserPermissionCard';
import RegistryBrowserDialog from './RegistryBrowserDialog';
import ToolDialogs from './ToolDialogs';

const Tools: React.FC = () => {
  const c = useClaudeTokens();
  const dispatch = useAppDispatch();
  const { items, builtinTools, builtinPermissions, loading } = useAppSelector((s) => s.tools);
  const { servers: regServersRaw, total: regTotal, loading: regLoading, stats: regStats, detail: regDetail, detailLoading: regDetailLoading } = useAppSelector((s) => s.mcpRegistry);
  const devMode = useAppSelector((s) => s.settings.data.dev_mode);
  const allTools = Object.values(items);
  const tools = allTools;
  const uninstalledIntegrations = useMemo(() => INTEGRATIONS.filter((ig) => !allTools.find((t) => t.name === ig.name)), [allTools]);
  const getIntegrationForTool = useCallback((tool: ToolDefinition) => INTEGRATIONS.find((ig) => ig.name === tool.name), []);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<ToolForm>(emptyForm);

  const [collapsedCategories, setCollapsedCategories] = useState<Record<string, boolean>>(
    Object.fromEntries([
      ...CATEGORY_ORDER.map((cat) => [cat, true]),
      ...CATEGORY_ORDER.map((cat) => [`d_${cat}`, true]),
    ]),
  );
  const [expandedBuiltin, setExpandedBuiltin] = useState<string | null>(null);
  const [coreSectionOpen, setCoreSectionOpen] = useState(false);
  const [deferredSectionOpen, setDeferredSectionOpen] = useState(false);
  const [customSectionOpen, setCustomSectionOpen] = useState(true);

  const [menuAnchor, setMenuAnchor] = useState<null | HTMLElement>(null);

  const [registryOpen, setRegistryOpen] = useState(false);
  const [regQuery, setRegQuery] = useState('');
  const [regSort, setRegSort] = useState<'name' | 'stars'>('stars');
  // Default 'curated' hides the long tail; client-side filter, backend still returns the full list.
  const [regSource, setRegSource] = useState<'' | 'community' | 'google' | 'curated'>('curated');

  // Curated whitelist matches the MCPSearch alias map in main.py (mcp-meta).
  const CURATED_MCP_NAMES = useMemo(() => new Set([
    'google-workspace', 'microsoft-365', 'slack', 'discord',
    'notion', 'airtable', 'hubspot', 'reddit', 'youtube',
  ]), []);
  const regServers = useMemo(() => {
    if (regSource !== 'curated') return regServersRaw;
    return regServersRaw.filter((srv: any) => {
      const id = (srv?.name || srv?.id || '').toLowerCase();
      return CURATED_MCP_NAMES.has(id);
    });
  }, [regServersRaw, regSource, CURATED_MCP_NAMES]);
  const [expandedServer, setExpandedServer] = useState<string | null>(null);
  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity?: 'success' | 'error' }>({ open: false, message: '' });
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [mcpConfigOpen, setMcpConfigOpen] = useState(false);
  const [mcpConfigServer, setMcpConfigServer] = useState<McpServer | null>(null);
  const [mcpAuthType, setMcpAuthType] = useState<'none' | 'env_vars'>('none');
  const [mcpCredentials, setMcpCredentials] = useState<Record<string, string>>({});
  const [mcpConfigJson, setMcpConfigJson] = useState('');
  const [mcpConfigError, setMcpConfigError] = useState('');

  const [expandedToolId, setExpandedToolId] = useState<string | null>(null);
  const [discovering, setDiscovering] = useState(false);

  const [integrationLoading, setIntegrationLoading] = useState<Record<string, boolean>>({});

  const [deviceCodeDialogOpen, setDeviceCodeDialogOpen] = useState(false);
  const [deviceCodeDialogToolId, setDeviceCodeDialogToolId] = useState<string | null>(null);
  const [deviceCode, setDeviceCode] = useState('');
  const [deviceCodeUrl, setDeviceCodeUrl] = useState('');
  const [deviceCodeStatus, setDeviceCodeStatus] = useState<'loading' | 'awaiting' | 'connected' | 'error'>('loading');

  const [credDialogOpen, setCredDialogOpen] = useState(false);
  const [credDialogToolId, setCredDialogToolId] = useState<string | null>(null);
  const [credDialogIntegration, setCredDialogIntegration] = useState<Integration | null>(null);
  const [credDialogValues, setCredDialogValues] = useState<Record<string, string>>({});
  const [credDialogSaving, setCredDialogSaving] = useState(false);

  const getInstalledIntegration = useCallback((integration: Integration): ToolDefinition | undefined => {
    return allTools.find((t) => t.name === integration.name);
  }, [allTools]);

  const handleIntegrationToggle = async (integration: Integration) => {
    const existing = getInstalledIntegration(integration);
    setIntegrationLoading((p) => ({ ...p, [integration.id]: true }));
    try {
      if (existing && existing.enabled !== false) {
        await dispatch(updateTool({ id: existing.id, enabled: false }));
        setSnackbar({ open: true, message: `Disabled ${integration.name}` });
      } else if (existing && existing.enabled === false) {
        await dispatch(updateTool({ id: existing.id, enabled: true }));
        if (integration.authType === 'oauth2' && existing.auth_status !== 'connected') {
          setSnackbar({ open: true, message: `Enabled ${integration.name}, connect your account to discover actions` });
        } else {
          setSnackbar({ open: true, message: `Enabled ${integration.name}, re-discovering actions…` });
          const discoverResult = await dispatch(discoverTools(existing.id));
          if (discoverTools.fulfilled.match(discoverResult)) {
            setSnackbar({ open: true, message: `${integration.name} ready, actions discovered` });
          } else {
            const detail = (discoverResult as any).error?.message || 'discovery failed';
            setSnackbar({ open: true, message: `${integration.name}: ${detail}`, severity: 'error' });
          }
        }
      } else {
        const result = await dispatch(createTool({
          name: integration.name,
          description: integration.description,
          command: '',
          mcp_config: integration.mcp_config,
          credentials: {},
          auth_type: integration.authType || 'none',
          auth_status: 'configured',
        }));
        if (createTool.fulfilled.match(result)) {
          const newTool = result.payload;
          if (integration.authType === 'oauth2' || integration.authType === 'device_code') {
            setSnackbar({ open: true, message: `Enabled ${integration.name}, connect your account to discover actions` });
          } else {
            setSnackbar({ open: true, message: `Enabled ${integration.name}, discovering actions…` });
            const discoverResult = await dispatch(discoverTools(newTool.id));
            if (discoverTools.fulfilled.match(discoverResult)) {
              setSnackbar({ open: true, message: `${integration.name} ready, actions discovered` });
            } else {
              const detail = (discoverResult as any).error?.message
                || `discovery failed; is ${integration.mcp_config.command || 'the server'} installed?`;
              setSnackbar({ open: true, message: `${integration.name}: ${detail}`, severity: 'error' });
            }
          }
        }
      }
    } finally {
      setIntegrationLoading((p) => ({ ...p, [integration.id]: false }));
    }
  };

  const handleDiscover = async (toolId: string) => {
    setDiscovering(true);
    try {
      const result = await dispatch(discoverTools(toolId));
      if (discoverTools.fulfilled.match(result)) {
        setSnackbar({ open: true, message: 'Actions discovered successfully' });
      } else {
        const detail = (result as any).error?.message || 'Discovery failed; is the MCP server running?';
        setSnackbar({ open: true, message: detail, severity: 'error' });
      }
    } finally {
      setDiscovering(false);
    }
  };

  const handlePermissionChange = async (toolId: string, toolName: string, policy: string) => {
    const tool = items[toolId];
    if (!tool) return;
    const updated = { ...tool.tool_permissions, [toolName]: policy };
    await dispatch(updateTool({ id: toolId, tool_permissions: updated }));
  };

  const handleGroupPermissionChange = async (toolId: string, names: string[], policy: string) => {
    const tool = items[toolId];
    if (!tool) return;
    const updated = { ...tool.tool_permissions };
    for (const name of names) updated[name] = policy;
    await dispatch(updateTool({ id: toolId, tool_permissions: updated }));
  };

  const handleBulkReadOnly = async (toolId: string) => {
    const tool = items[toolId];
    if (!tool?.tool_permissions?._categories) return;
    const readNames: string[] = tool.tool_permissions._categories.read || [];
    const updated = { ...tool.tool_permissions };
    for (const name of readNames) updated[name] = 'always_allow';
    await dispatch(updateTool({ id: toolId, tool_permissions: updated }));
  };

  const handleResetPermissions = async (toolId: string) => {
    const tool = items[toolId];
    if (!tool?.tool_permissions) return;
    const updated = { ...tool.tool_permissions };
    for (const key of Object.keys(updated)) {
      if (!key.startsWith('_')) updated[key] = 'ask';
    }
    await dispatch(updateTool({ id: toolId, tool_permissions: updated }));
  };

  const [expandedServices, setExpandedServices] = useState<Record<string, boolean>>({});
  const [expandedSchema, setExpandedSchema] = useState<string | null>(null);

  const [browserSectionOpen, setBrowserSectionOpen] = useState(false);
  const [browserCollapsed, setBrowserCollapsed] = useState<Record<string, boolean>>({ browser_delegation: true, browser_action: true });
  const [builtinSectionOpen, setBuiltinSectionOpen] = useState(true);

  useEffect(() => {
    dispatch(fetchTools());
    dispatch(fetchBuiltinTools());
    dispatch(fetchBuiltinPermissions());
  }, [dispatch]);

  const handleBuiltinPermissionChange = async (toolName: string, policy: string) => {
    await dispatch(updateBuiltinPermissions({ [toolName]: policy }));
  };

  const handleBuiltinCategoryPermissionChange = async (toolNames: string[], policy: string) => {
    const perms: Record<string, string> = {};
    for (const name of toolNames) perms[name] = policy;
    await dispatch(updateBuiltinPermissions(perms));
  };

  const BROWSER_CATEGORIES = new Set(['browser_delegation', 'browser_action']);
  const coreTools = useMemo(() => builtinTools.filter((bt) => !bt.deferred && !BROWSER_CATEGORIES.has(bt.category)), [builtinTools]);
  const deferredTools = useMemo(() => builtinTools.filter((bt) => bt.deferred && !BROWSER_CATEGORIES.has(bt.category)), [builtinTools]);
  const browserTools = useMemo(() => builtinTools.filter((bt) => BROWSER_CATEGORIES.has(bt.category)), [builtinTools]);
  const browserDelegationTools = useMemo(() => browserTools.filter((bt) => bt.category === 'browser_delegation'), [browserTools]);
  const browserActionTools = useMemo(() => browserTools.filter((bt) => bt.category === 'browser_action'), [browserTools]);
  const groupTools = (list: BuiltinTool[]) => {
    const g: Record<string, BuiltinTool[]> = {};
    for (const bt of list) { if (!g[bt.category]) g[bt.category] = []; g[bt.category].push(bt); }
    return g;
  };
  const groupedCore = useMemo(() => groupTools(coreTools), [coreTools]);
  const groupedDeferred = useMemo(() => groupTools(deferredTools), [deferredTools]);

  const coreSectionEnabled = useMemo(
    () => !coreTools.every((t) => builtinPermissions[t.name] === 'deny'),
    [coreTools, builtinPermissions],
  );
  const deferredSectionEnabled = useMemo(
    () => !deferredTools.every((t) => builtinPermissions[t.name] === 'deny'),
    [deferredTools, builtinPermissions],
  );
  const browserSectionEnabled = useMemo(
    () => browserTools.length > 0 && !browserTools.every((t) => builtinPermissions[t.name] === 'deny'),
    [browserTools, builtinPermissions],
  );

  const handleSectionEnabledChange = async (tools: BuiltinTool[], enabled: boolean) => {
    const perms: Record<string, string> = {};
    for (const t of tools) perms[t.name] = enabled ? 'always_allow' : 'deny';
    await dispatch(updateBuiltinPermissions(perms));
  };

  const toggleCategory = (cat: string) => setCollapsedCategories((p) => ({ ...p, [cat]: !p[cat] }));
  const toggleBuiltinExpand = (name: string) => setExpandedBuiltin((p) => (p === name ? null : name));

  const handleMenuOpen = (e: React.MouseEvent<HTMLElement>) => setMenuAnchor(e.currentTarget);
  const handleMenuClose = () => setMenuAnchor(null);

  const openCreate = () => {
    handleMenuClose();
    setEditingId(null);
    setForm(emptyForm);
    setDialogOpen(true);
  };

  const openRegistryBrowser = () => {
    handleMenuClose();
    setRegistryOpen(true);
    setRegQuery('');
    setRegSort('stars');
    setRegSource('');
    setExpandedServer(null);
    dispatch(fetchRegistryStats());
    dispatch(searchRegistry({ q: '', limit: 20, offset: 0, sort: 'stars', source: '' }));
  };

  const openEdit = (tool: ToolDefinition) => {
    setEditingId(tool.id);
    setForm({ name: tool.name, description: tool.description, command: tool.command });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    const payload = { name: form.name, description: form.description, command: form.command };
    if (editingId) { await dispatch(updateTool({ id: editingId, ...payload })); } else { await dispatch(createTool(payload)); }
    setDialogOpen(false);
  };

  const handleDelete = async (id: string) => { await dispatch(deleteTool(id)); };

  // Translate UI "curated" pseudo-source to "" for the backend; the whitelist is applied client-side.
  const _backendSource = (s: '' | 'community' | 'google' | 'curated'): '' | 'community' | 'google' =>
    s === 'curated' ? '' : s;

  const handleRegSearch = useCallback((q: string, sort?: 'name' | 'stars', source?: '' | 'community' | 'google' | 'curated') => {
    setRegQuery(q);
    setExpandedServer(null);
    const sortVal = sort ?? regSort;
    const sourceVal = source ?? regSource;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      dispatch(searchRegistry({ q, limit: 20, offset: 0, sort: sortVal, source: _backendSource(sourceVal) }));
    }, 300);
  }, [dispatch, regSort, regSource]);

  const handleLoadMore = () => {
    dispatch(searchRegistry({ q: regQuery, limit: 20, offset: regServersRaw.length, sort: regSort, source: _backendSource(regSource) }));
  };

  const handleRegSort = (sort: 'name' | 'stars') => {
    setRegSort(sort);
    setExpandedServer(null);
    dispatch(searchRegistry({ q: regQuery, limit: 20, offset: 0, sort, source: _backendSource(regSource) }));
  };

  const handleRegSourceFilter = (_: React.MouseEvent<HTMLElement>, val: '' | 'community' | 'google' | 'curated') => {
    if (val === null) return;
    setRegSource(val);
    setExpandedServer(null);
    dispatch(searchRegistry({ q: regQuery, limit: 20, offset: 0, sort: regSort, source: _backendSource(val) }));
  };

  const openMcpConfigDialog = (srv: McpServer) => {
    setMcpConfigServer(srv);
    setMcpAuthType('none');
    setMcpCredentials({});
    const derivedConfig = serverToMcpConfig(srv);
    setMcpConfigJson(JSON.stringify(
      Object.keys(derivedConfig).length > 0 ? derivedConfig : {},
      null, 2,
    ));
    setMcpConfigError('');
    setMcpConfigOpen(true);
  };

  const handleMcpConfigSave = async () => {
    if (!mcpConfigServer) return;
    let parsedConfig: Record<string, any> = {};
    try { parsedConfig = JSON.parse(mcpConfigJson); } catch { setMcpConfigError('Invalid JSON'); return; }

    const f = serverToToolForm(mcpConfigServer);
    const authStatus = 'configured';

    await dispatch(createTool({
      name: f.name,
      description: f.description,
      command: '',
      mcp_config: parsedConfig,
      credentials: mcpCredentials,
      auth_type: mcpAuthType,
      auth_status: authStatus,
    }));

    setMcpConfigOpen(false);
    setSnackbar({ open: true, message: `Installed "${f.name}" as MCP tool` });
  };

  const handleInstall = async (srv: McpServer) => {
    const f = serverToToolForm(srv);
    const mcpConfig = serverToMcpConfig(srv);
    const hasConfig = Object.keys(mcpConfig).length > 0;

    if (srv.source === 'google' && srv.remoteUrl && hasConfig) {
      await dispatch(createTool({
        name: f.name,
        description: f.description,
        command: '',
        mcp_config: mcpConfig,
        credentials: {},
        auth_type: 'oauth2',
        auth_status: 'configured',
      }));
      setSnackbar({ open: true, message: `Installed "${f.name}", click "Connect Google" to authorize` });
    } else if (hasConfig && mcpConfig.type === 'stdio') {
      const result = await dispatch(createTool({
        name: f.name,
        description: f.description,
        command: '',
        mcp_config: mcpConfig,
        credentials: {},
        auth_type: 'none',
        auth_status: 'configured',
      }));
      if (createTool.fulfilled.match(result)) {
        const newTool = result.payload;
        setSnackbar({ open: true, message: `Installed "${f.name}", discovering actions…` });
        const discoverResult = await dispatch(discoverTools(newTool.id));
        if (discoverTools.fulfilled.match(discoverResult)) {
          setSnackbar({ open: true, message: `${f.name} ready, actions discovered` });
        } else {
          const detail = (discoverResult as any).error?.message
            || 'discovery failed; the MCP server may need setup first';
          setSnackbar({ open: true, message: `${f.name}: ${detail}`, severity: 'error' });
        }
      }
    } else {
      openMcpConfigDialog(srv);
    }
  };

  const handleEditInstall = (srv: McpServer) => {
    setRegistryOpen(false);
    const f = serverToToolForm(srv);
    setEditingId(null);
    setForm(f);
    setDialogOpen(true);
  };

  const handleOAuthConnect = async (toolId: string) => {
    const result = await dispatch(startOAuth(toolId));
    if (startOAuth.fulfilled.match(result)) {
      const { auth_url } = result.payload;
      const popup = window.open(auth_url, 'oauth', 'width=500,height=700,left=200,top=100');

      const afterConnect = async () => {
        const statusResult = await dispatch(fetchToolStatus(toolId));
        if (fetchToolStatus.fulfilled.match(statusResult) && statusResult.payload.auth_status === 'connected') {
          setSnackbar({ open: true, message: 'Account connected! Discovering actions…' });
          setExpandedToolId(toolId);
          dispatch(discoverTools(toolId));
        } else {
          setSnackbar({ open: true, message: 'Account connected!' });
        }
      };

      const onMessage = (event: MessageEvent) => {
        if (event.data?.type === 'oauth_complete' && event.data?.tool_id === toolId) {
          afterConnect();
          window.removeEventListener('message', onMessage);
        }
      };
      window.addEventListener('message', onMessage);

      const pollInterval = setInterval(() => {
        if (popup?.closed) {
          clearInterval(pollInterval);
          afterConnect();
          window.removeEventListener('message', onMessage);
        }
      }, 1000);
    } else {
      setSnackbar({ open: true, message: 'OAuth failed; check that OAuth credentials are set in backend .env', severity: 'error' });
    }
  };

  const handleDeviceCodeConnect = async (toolId: string) => {
    setDeviceCodeDialogToolId(toolId);
    setDeviceCodeStatus('loading');
    setDeviceCode('');
    setDeviceCodeUrl('');
    setDeviceCodeDialogOpen(true);

    const result = await dispatch(startDeviceCodeLogin(toolId));
    if (startDeviceCodeLogin.fulfilled.match(result)) {
      const { device_code, device_code_url } = result.payload;
      setDeviceCode(device_code);
      const url = device_code_url || 'https://login.microsoft.com/device';
      setDeviceCodeUrl(url);
      setDeviceCodeStatus('awaiting');

      window.open(url, 'm365-login', 'width=500,height=700,left=200,top=100');

      const poll = setInterval(async () => {
        const statusResult = await dispatch(pollDeviceCodeStatus(toolId));
        if (pollDeviceCodeStatus.fulfilled.match(statusResult)) {
          const { status, email } = statusResult.payload;
          if (status === 'connected') {
            clearInterval(poll);
            setDeviceCodeStatus('connected');
            setSnackbar({ open: true, message: `Connected to Microsoft 365${email ? ` as ${email}` : ''}! Discovering actions…` });
            setDeviceCodeDialogOpen(false);
            setExpandedToolId(toolId);
            await dispatch(fetchToolStatus(toolId));
            dispatch(discoverTools(toolId));
          } else if (status === 'error') {
            clearInterval(poll);
            setDeviceCodeStatus('error');
          }
        }
      }, 2000);

      setTimeout(() => clearInterval(poll), 300000);
    } else {
      setDeviceCodeStatus('error');
    }
  };

  const handleM365Disconnect = async (toolId: string) => {
    await dispatch(disconnectM365(toolId));
    setSnackbar({ open: true, message: 'Disconnected from Microsoft 365' });
  };

  const openCredentialsDialog = (toolId: string, integration: Integration) => {
    const tool = items[toolId];
    const existing = tool?.credentials || {};
    const initial: Record<string, string> = {};
    for (const field of integration.credentialFields || []) {
      initial[field.key] = existing[field.key] || '';
    }
    setCredDialogToolId(toolId);
    setCredDialogIntegration(integration);
    setCredDialogValues(initial);
    setCredDialogOpen(true);
  };

  const handleCredentialsSave = async () => {
    if (!credDialogToolId || !credDialogIntegration) return;
    const hasEmpty = (credDialogIntegration.credentialFields || []).some((f) => !credDialogValues[f.key]?.trim());
    if (hasEmpty) return;

    setCredDialogSaving(true);
    try {
      const result = await dispatch(updateTool({
        id: credDialogToolId,
        credentials: credDialogValues,
        auth_type: 'env_vars',
        auth_status: 'connected',
      }));
      if (updateTool.fulfilled.match(result)) {
        setCredDialogOpen(false);
        setSnackbar({ open: true, message: `${credDialogIntegration.name} connected! Re-discovering actions…` });
        dispatch(discoverTools(credDialogToolId));
      } else {
        setSnackbar({ open: true, message: 'Failed to save credentials', severity: 'error' });
      }
    } finally {
      setCredDialogSaving(false);
    }
  };

  const handleSlackAutoConnect = async () => {
    if (!credDialogToolId || !credDialogIntegration) return;
    const slackBridge = (window as any).openswarm?.connectSlack;
    if (!slackBridge) {
      setSnackbar({ open: true, message: 'Slack auto-connect requires the desktop app', severity: 'error' });
      return;
    }
    setCredDialogSaving(true);
    try {
      const { token, cookie } = await slackBridge();
      const creds = { SLACK_MCP_XOXC_TOKEN: token, SLACK_MCP_XOXD_TOKEN: cookie };
      const result = await dispatch(updateTool({
        id: credDialogToolId,
        credentials: creds,
        auth_type: 'env_vars',
        auth_status: 'connected',
      }));
      if (updateTool.fulfilled.match(result)) {
        setCredDialogOpen(false);
        setSnackbar({ open: true, message: 'Slack connected! Re-discovering actions…' });
        dispatch(discoverTools(credDialogToolId));
      } else {
        setSnackbar({ open: true, message: 'Failed to save Slack credentials', severity: 'error' });
      }
    } catch (err: any) {
      setSnackbar({ open: true, message: err?.message || 'Slack sign-in cancelled', severity: 'error' });
    } finally {
      setCredDialogSaving(false);
    }
  };

  const handleDisconnectIntegration = async (toolId: string, integration: Integration) => {
    if (integration.authType === 'oauth2') {
      fetch(`${API_BASE}/tools/${toolId}/oauth/disconnect`, { method: 'POST' }).catch(() => {});
      const result = await dispatch(updateTool({
        id: toolId,
        oauth_tokens: {},
        auth_status: 'configured',
        connected_account_email: '',
      }));
      if (updateTool.fulfilled.match(result)) {
        setSnackbar({ open: true, message: `${integration.name} disconnected. You can now connect a different account.` });
      } else {
        setSnackbar({ open: true, message: `Failed to disconnect ${integration.name}`, severity: 'error' });
      }
    } else {
      await dispatch(updateTool({
        id: toolId,
        credentials: {},
        auth_type: 'none',
        auth_status: 'configured',
      }));
      setSnackbar({ open: true, message: `${integration.name} disconnected` });
    }
  };

  return (
    <Box sx={{ p: 3, height: '100%', overflow: 'auto' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3 }}>
        <Box>
          <Typography variant="h5" sx={{ color: c.text.primary, fontWeight: 700, mb: 0.5 }}>Action Library</Typography>
          <Typography sx={{ color: c.text.tertiary, fontSize: '0.9rem' }}>Define and manage custom actions for your Claude Code agents.</Typography>
        </Box>
        <Box>
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            endIcon={<KeyboardArrowDownIcon sx={{ fontSize: 18 }} />}
            onClick={handleMenuOpen}
            sx={{ bgcolor: c.accent.primary, '&:hover': { bgcolor: c.accent.pressed }, textTransform: 'none', borderRadius: 2 }}
          >
            New Action
          </Button>
          <Menu
            anchorEl={menuAnchor}
            open={!!menuAnchor}
            onClose={handleMenuClose}
            PaperProps={{ sx: { bgcolor: c.bg.surface, border: `1px solid ${c.border.subtle}`, borderRadius: 2, mt: 0.5, minWidth: 200 } }}
          >
            <MenuItem onClick={openCreate} sx={{ color: c.text.primary, fontSize: '0.88rem', gap: 1.5, '&:hover': { bgcolor: c.bg.secondary } }}>
              <BuildIcon sx={{ fontSize: 16, color: c.text.tertiary }} />
              Create Custom
            </MenuItem>
            <MenuItem onClick={openRegistryBrowser} sx={{ color: c.text.primary, fontSize: '0.88rem', gap: 1.5, '&:hover': { bgcolor: c.bg.secondary } }}>
              <StorefrontIcon sx={{ fontSize: 16, color: c.text.tertiary }} />
              Browse MCP Registry
            </MenuItem>
          </Menu>
        </Box>
      </Box>

      <Box sx={{ mb: 3 }}>
        <Box
          onClick={() => setBuiltinSectionOpen((v) => !v)}
          sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 1, cursor: 'pointer', userSelect: 'none', '&:hover .section-arrow': { color: c.text.secondary } }}
        >
          {builtinSectionOpen ? <KeyboardArrowDownIcon className="section-arrow" sx={{ fontSize: 18, color: c.text.tertiary, transition: 'color 0.15s' }} /> : <KeyboardArrowRightIcon className="section-arrow" sx={{ fontSize: 18, color: c.text.tertiary, transition: 'color 0.15s' }} />}
          <LockIcon sx={{ fontSize: 14, color: c.text.tertiary }} />
          <Typography sx={{ color: c.text.muted, fontWeight: 600, fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Built-in Action Sets</Typography>
          <Chip label={coreTools.length + deferredTools.length + browserTools.length} size="small" sx={{ bgcolor: c.bg.secondary, color: c.text.muted, fontSize: '0.7rem', height: 18, minWidth: 24, '& .MuiChip-label': { px: 0.8 } }} />
        </Box>
        <Collapse in={builtinSectionOpen} timeout={0} unmountOnExit>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, pl: 1 }}>

      {coreTools.length > 0 && (
        <ToolSection label="Core Actions" icon={<LockIcon sx={{ fontSize: 14, color: c.text.tertiary }} />} count={coreTools.length} open={coreSectionOpen} onToggle={() => setCoreSectionOpen((v) => !v)} grouped={groupedCore} collapsedCategories={collapsedCategories} toggleCategory={toggleCategory} expandedBuiltin={expandedBuiltin} toggleBuiltinExpand={toggleBuiltinExpand} builtinPermissions={builtinPermissions} onPermissionChange={handleBuiltinPermissionChange} onCategoryPermissionChange={handleBuiltinCategoryPermissionChange} enabled={coreSectionEnabled} onEnabledChange={(v) => handleSectionEnabledChange(coreTools, v)} />
      )}

      {deferredTools.length > 0 && (
        <ToolSection label="Extended Actions" icon={<HourglassEmptyIcon sx={{ fontSize: 14, color: c.text.tertiary }} />} count={deferredTools.length} open={deferredSectionOpen} onToggle={() => setDeferredSectionOpen((v) => !v)} grouped={groupedDeferred} collapsedCategories={collapsedCategories} toggleCategory={toggleCategory} expandedBuiltin={expandedBuiltin} toggleBuiltinExpand={toggleBuiltinExpand} deferred builtinPermissions={builtinPermissions} onPermissionChange={handleBuiltinPermissionChange} onCategoryPermissionChange={handleBuiltinCategoryPermissionChange} enabled={deferredSectionEnabled} onEnabledChange={(v) => handleSectionEnabledChange(deferredTools, v)} />
      )}

      {browserTools.length > 0 && (
        <BrowserPermissionCard
          open={browserSectionOpen}
          enabled={browserSectionEnabled}
          onToggleOpen={() => setBrowserSectionOpen((v) => !v)}
          browserTools={browserTools}
          browserDelegationTools={browserDelegationTools}
          browserActionTools={browserActionTools}
          browserCollapsed={browserCollapsed}
          setBrowserCollapsed={setBrowserCollapsed}
          builtinPermissions={builtinPermissions}
          onSectionEnabledChange={handleSectionEnabledChange}
          onCategoryPermissionChange={handleBuiltinCategoryPermissionChange}
          onPermissionChange={handleBuiltinPermissionChange}
        />
      )}

          </Box>
        </Collapse>
      </Box>

      <Box sx={{ mb: 2 }}>
        <Box onClick={() => setCustomSectionOpen((v) => !v)} sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 1, cursor: 'pointer', userSelect: 'none', '&:hover .section-arrow': { color: c.text.secondary } }}>
          {customSectionOpen ? <KeyboardArrowDownIcon className="section-arrow" sx={{ fontSize: 18, color: c.text.tertiary, transition: 'color 0.15s' }} /> : <KeyboardArrowRightIcon className="section-arrow" sx={{ fontSize: 18, color: c.text.tertiary, transition: 'color 0.15s' }} />}
          <BuildIcon sx={{ fontSize: 14, color: c.text.tertiary }} />
          <Typography sx={{ color: c.text.muted, fontWeight: 600, fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Custom Action Sets</Typography>
          <Chip label={tools.length + uninstalledIntegrations.length} size="small" sx={{ bgcolor: c.bg.secondary, color: c.text.muted, fontSize: '0.7rem', height: 18, minWidth: 24, '& .MuiChip-label': { px: 0.8 } }} />
        </Box>
        <Collapse in={customSectionOpen} timeout={0} unmountOnExit>
          {loading ? (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, pl: 1, mt: 1 }}>
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} variant="card" height={72} />
              ))}
            </Box>
          ) : (tools.length === 0 && uninstalledIntegrations.length === 0) ? (
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', py: 6, color: c.text.ghost, gap: 1.5 }}>
              <BuildIcon sx={{ fontSize: 40, opacity: 0.3 }} />
              <Typography sx={{ fontSize: '0.9rem' }}>No custom actions defined yet. Create one to get started.</Typography>
            </Box>
          ) : (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, pl: 1 }}>
              {uninstalledIntegrations.map((ig) => {
                const isLoading = !!integrationLoading[ig.id];
                return (
                  <Card
                    key={ig.id}
                    sx={{ order: 2, bgcolor: c.bg.surface, border: `1px solid ${c.border.subtle}`, borderRadius: 2, boxShadow: c.shadow.sm, transition: 'border-color 0.2s, box-shadow 0.2s' }}
                  >
                    <CardContent sx={{ py: 1.5, px: 2, '&:last-child': { pb: 1.5 } }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                        <Box sx={{
                          width: 36, height: 36, borderRadius: 2, display: 'flex', alignItems: 'center', justifyContent: 'center',
                          bgcolor: c.bg.secondary, fontSize: '1.1rem', fontWeight: 700, color: c.text.ghost,
                        }}>
                          {ig.icon}
                        </Box>
                        <Box sx={{ flex: 1, minWidth: 0 }}>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.25 }}>
                            <Typography sx={{ color: c.text.primary, fontWeight: 600, fontSize: '0.95rem' }}>{ig.name}</Typography>
                            <Chip component="a" href={ig.website} clickable icon={<OpenInNewIcon sx={{ fontSize: 10 }} />} label="docs" size="small" sx={{ bgcolor: c.bg.secondary, color: c.text.ghost, fontSize: '0.65rem', height: 18, '& .MuiChip-label': { px: 0.4 }, '& .MuiChip-icon': { ml: 0.4, fontSize: 10 } }} />
                          </Box>
                          <Typography sx={{ color: c.text.muted, fontSize: '0.84rem' }}>{ig.description}</Typography>
                        </Box>
                        <Box
                          data-onboarding={
                            ig.id === 'youtube'
                              ? 'actions-youtube-toggle'
                              : ig.id === 'reddit'
                                ? 'actions-reddit-toggle'
                                : undefined
                          }
                          sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexShrink: 0 }}
                        >
                          {isLoading && <CircularProgress size={16} sx={{ color: ig.color }} />}
                          <Switch
                            checked={false}
                            onChange={() => handleIntegrationToggle(ig)}
                            disabled={isLoading}
                            sx={{
                              '& .MuiSwitch-switchBase.Mui-checked': { color: ig.color },
                              '& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track': { bgcolor: ig.color },
                            }}
                          />
                        </Box>
                      </Box>
                    </CardContent>
                  </Card>
                );
              })}
              {tools.map((tool) => {
                const ig = getIntegrationForTool(tool);
                const isExpanded = expandedToolId === tool.id;
                const isMcp = tool.mcp_config && Object.keys(tool.mcp_config).length > 0;
                const isStdio = isMcp && (tool.mcp_config.type === 'stdio' || !!tool.mcp_config.command);
                const canDiscover = isMcp;
                const perms = tool.tool_permissions || {};
                const services = perms._services as Record<string, { read?: string[]; write?: string[] }> | undefined;
                const descriptions = (perms._tool_descriptions || {}) as Record<string, string>;
                const schemas = (perms._tool_schemas || {}) as Record<string, any>;
                const serviceNames = services ? Object.keys(services) : [];
                const hasPerms = serviceNames.length > 0;
                const totalToolCount = serviceNames.reduce((acc, s) => acc + (services![s].read?.length || 0) + (services![s].write?.length || 0), 0);

                const toDisplayName = (name: string, serviceName?: string) => {
                  let display = name.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
                  if (serviceName) {
                    const svcLower = serviceName.toLowerCase();
                    const variants = [svcLower, svcLower.replace(/s$/, '')];
                    for (const v of variants) {
                      display = display.replace(new RegExp(`\\b${v}\\b`, 'gi'), '').trim();
                    }
                    display = display.replace(/\s{2,}/g, ' ').trim();
                  }
                  return display;
                };

                const firstSentence = (desc: string) => {
                  if (!desc) return '';
                  const match = desc.match(/^(.+?(?:\.|$))/);
                  return match ? match[1].trim() : desc.substring(0, 100);
                };

                const getGroupPolicy = (names: string[]) => {
                  if (names.length === 0) return 'ask';
                  const policies = names.map((n) => perms[n] || 'ask');
                  if (policies.every((p) => p === 'always_allow')) return 'always_allow';
                  if (policies.every((p) => p === 'deny')) return 'deny';
                  if (policies.every((p) => p === 'ask')) return 'ask';
                  return 'mixed';
                };

                const PermToggle = ({ value, onChange, size = 16 }: { value: string; onChange: (v: string) => void; size?: number }) => (
                  <Box sx={{ display: 'flex', gap: 0.25 }} onClick={(e) => e.stopPropagation()}>
                    <Tooltip title="Always allow"><IconButton size="small" onClick={() => onChange('always_allow')} sx={{ p: 0.4, borderRadius: 1, bgcolor: value === 'always_allow' ? `${c.status.success}20` : 'transparent', color: value === 'always_allow' ? c.status.success : c.text.ghost, '&:hover': { bgcolor: `${c.status.success}15`, color: c.status.success } }}><CheckCircleIcon sx={{ fontSize: size }} /></IconButton></Tooltip>
                    <Tooltip title="Ask permission"><IconButton size="small" onClick={() => onChange('ask')} sx={{ p: 0.4, borderRadius: 1, bgcolor: value === 'ask' ? `${c.status.warning}20` : 'transparent', color: value === 'ask' ? c.status.warning : c.text.ghost, '&:hover': { bgcolor: `${c.status.warning}15`, color: c.status.warning } }}><PanToolIcon sx={{ fontSize: size }} /></IconButton></Tooltip>
                    <Tooltip title="Always deny"><IconButton size="small" onClick={() => onChange('deny')} sx={{ p: 0.4, borderRadius: 1, bgcolor: value === 'deny' ? `${c.status.error}20` : 'transparent', color: value === 'deny' ? c.status.error : c.text.ghost, '&:hover': { bgcolor: `${c.status.error}15`, color: c.status.error } }}><BlockIcon sx={{ fontSize: size }} /></IconButton></Tooltip>
                  </Box>
                );

                const ServiceGroup = ({ serviceName, data, isFirstGroup }: { serviceName: string; data: { read?: string[]; write?: string[] }; isFirstGroup?: boolean }) => {
                  const svcKey = `${tool.id}:${serviceName}`;
                  const isOpen = expandedServices[svcKey] ?? false;
                  const allNames = [...(data.read || []), ...(data.write || [])];
                  const svcPolicy = getGroupPolicy(allNames);
                  const count = allNames.length;
                  const isReddit =
                    ig?.id === 'reddit' ||
                    tool.name?.toLowerCase() === 'reddit' ||
                    (tool.command || '').toLowerCase().includes('reddit');
                  const isYoutube =
                    ig?.id === 'youtube' ||
                    tool.name?.toLowerCase() === 'youtube' ||
                    (tool.command || '').toLowerCase().includes('youtube');
                  const isSubredditsForReddit =
                    isReddit && /subreddit/i.test(serviceName);
                  // YouTube marker lands on the first service group since YouTube has no drill-down.
                  const showPermissionMarker =
                    isSubredditsForReddit || (isYoutube && isFirstGroup);

                  return (
                    <Box sx={{ border: `1px solid ${c.border.subtle}`, borderRadius: 1.5, overflow: 'hidden', '&:hover': { borderColor: `${c.border.medium}` } }}>
                      <Box
                        data-onboarding={isSubredditsForReddit ? 'actions-subreddits-chevron' : undefined}
                        sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: 1.5, py: 0.75, cursor: 'pointer', bgcolor: isOpen ? c.bg.secondary : 'transparent', '&:hover': { bgcolor: c.bg.secondary } }}
                        onClick={() => setExpandedServices((p) => ({ ...p, [svcKey]: !isOpen }))}
                      >
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <KeyboardArrowDownIcon sx={{ fontSize: 16, color: c.text.ghost, transition: 'transform 0.15s', transform: isOpen ? 'rotate(0deg)' : 'rotate(-90deg)' }} />
                          <Typography sx={{ color: c.text.primary, fontSize: '0.85rem', fontWeight: 600 }}>{serviceName}</Typography>
                          <Chip label={count} size="small" sx={{ bgcolor: c.bg.page, color: c.text.muted, fontSize: '0.65rem', height: 18, '& .MuiChip-label': { px: 0.6 } }} />
                        </Box>
                        <Box data-onboarding={showPermissionMarker ? 'actions-permission-toggle' : undefined}>
                          <PermToggle value={svcPolicy === 'mixed' ? 'ask' : svcPolicy} onChange={(v) => handleGroupPermissionChange(tool.id, allNames, v)} />
                        </Box>
                      </Box>
                      <Collapse in={isOpen} timeout={0} unmountOnExit>
                        <Box sx={{ px: 1, pb: 1 }}>
                          {(data.read?.length || 0) > 0 && (
                            <Box sx={{ mt: 0.5 }}>
                              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: 0.5, py: 0.25 }}>
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                  <VisibilityIcon sx={{ fontSize: 12, color: c.status.info }} />
                                  <Typography sx={{ color: c.text.muted, fontSize: '0.72rem', fontWeight: 600 }}>Read-only</Typography>
                                  <Chip label={data.read!.length} size="small" sx={{ bgcolor: c.bg.page, color: c.text.ghost, fontSize: '0.6rem', height: 14, '& .MuiChip-label': { px: 0.4 } }} />
                                </Box>
                                <PermToggle value={getGroupPolicy(data.read!) === 'mixed' ? 'ask' : getGroupPolicy(data.read!)} onChange={(v) => handleGroupPermissionChange(tool.id, data.read!, v)} size={14} />
                              </Box>
                              {data.read!.map((name) => {
                                const schemaKey = `${tool.id}:${name}`;
                                const schema = schemas[name];
                                const schemaProps = schema?.properties as Record<string, any> | undefined;
                                const schemaRequired = (schema?.required || []) as string[];
                                return (
                                  <Box key={name}>
                                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', py: 0.4, px: 1.5, borderRadius: 1, cursor: devMode && schema ? 'pointer' : undefined, '&:hover': { bgcolor: c.bg.secondary } }} onClick={() => devMode && schema && setExpandedSchema((p) => p === schemaKey ? null : schemaKey)}>
                                      <Box sx={{ minWidth: 0, flex: 1, mr: 1 }}>
                                        <Typography sx={{ color: c.text.primary, fontSize: '0.8rem', fontWeight: 500 }}>{toDisplayName(name, serviceName)}</Typography>
                                        {descriptions[name] && <Typography sx={{ color: c.text.ghost, fontSize: '0.7rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{firstSentence(descriptions[name])}</Typography>}
                                      </Box>
                                      <PermToggle value={perms[name] || 'ask'} onChange={(v) => handlePermissionChange(tool.id, name, v)} size={14} />
                                    </Box>
                                    {devMode && expandedSchema === schemaKey && schemaProps && (
                                      <Box sx={{ mx: 1.5, mb: 0.75, px: 1.5, py: 1, bgcolor: c.bg.page, borderRadius: 1, border: `1px solid ${c.border.subtle}` }}>
                                        <Typography sx={{ color: c.text.ghost, fontSize: '0.65rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', mb: 0.5 }}>Input Parameters</Typography>
                                        {Object.entries(schemaProps).map(([pName, pDef]: [string, any]) => (
                                          <Box key={pName} sx={{ display: 'flex', alignItems: 'baseline', gap: 0.75, py: 0.2 }}>
                                            <Typography sx={{ color: c.accent.primary, fontSize: '0.72rem', fontFamily: c.font.mono, fontWeight: 600, flexShrink: 0 }}>{pName}</Typography>
                                            <Typography sx={{ color: c.text.muted, fontSize: '0.68rem', fontFamily: c.font.mono }}>{pDef?.type || 'any'}</Typography>
                                            {schemaRequired.includes(pName) && <Chip label="required" size="small" sx={{ bgcolor: `${c.status.error}12`, color: c.status.error, fontSize: '0.55rem', height: 14, '& .MuiChip-label': { px: 0.4 } }} />}
                                            {pDef?.description && <Typography sx={{ color: c.text.ghost, fontSize: '0.68rem', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{pDef.description}</Typography>}
                                          </Box>
                                        ))}
                                      </Box>
                                    )}
                                  </Box>
                                );
                              })}
                            </Box>
                          )}
                          {(data.write?.length || 0) > 0 && (
                            <Box sx={{ mt: 0.5 }}>
                              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: 0.5, py: 0.25 }}>
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                  <EditIcon sx={{ fontSize: 12, color: c.status.warning }} />
                                  <Typography sx={{ color: c.text.muted, fontSize: '0.72rem', fontWeight: 600 }}>Write / delete</Typography>
                                  <Chip label={data.write!.length} size="small" sx={{ bgcolor: c.bg.page, color: c.text.ghost, fontSize: '0.6rem', height: 14, '& .MuiChip-label': { px: 0.4 } }} />
                                </Box>
                                <PermToggle value={getGroupPolicy(data.write!) === 'mixed' ? 'ask' : getGroupPolicy(data.write!)} onChange={(v) => handleGroupPermissionChange(tool.id, data.write!, v)} size={14} />
                              </Box>
                              {data.write!.map((name) => {
                                const schemaKey = `${tool.id}:${name}`;
                                const schema = schemas[name];
                                const schemaProps = schema?.properties as Record<string, any> | undefined;
                                const schemaRequired = (schema?.required || []) as string[];
                                return (
                                  <Box key={name}>
                                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', py: 0.4, px: 1.5, borderRadius: 1, cursor: devMode && schema ? 'pointer' : undefined, '&:hover': { bgcolor: c.bg.secondary } }} onClick={() => devMode && schema && setExpandedSchema((p) => p === schemaKey ? null : schemaKey)}>
                                      <Box sx={{ minWidth: 0, flex: 1, mr: 1 }}>
                                        <Typography sx={{ color: c.text.primary, fontSize: '0.8rem', fontWeight: 500 }}>{toDisplayName(name, serviceName)}</Typography>
                                        {descriptions[name] && <Typography sx={{ color: c.text.ghost, fontSize: '0.7rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{firstSentence(descriptions[name])}</Typography>}
                                      </Box>
                                      <PermToggle value={perms[name] || 'ask'} onChange={(v) => handlePermissionChange(tool.id, name, v)} size={14} />
                                    </Box>
                                    {devMode && expandedSchema === schemaKey && schemaProps && (
                                      <Box sx={{ mx: 1.5, mb: 0.75, px: 1.5, py: 1, bgcolor: c.bg.page, borderRadius: 1, border: `1px solid ${c.border.subtle}` }}>
                                        <Typography sx={{ color: c.text.ghost, fontSize: '0.65rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', mb: 0.5 }}>Input Parameters</Typography>
                                        {Object.entries(schemaProps).map(([pName, pDef]: [string, any]) => (
                                          <Box key={pName} sx={{ display: 'flex', alignItems: 'baseline', gap: 0.75, py: 0.2 }}>
                                            <Typography sx={{ color: c.accent.primary, fontSize: '0.72rem', fontFamily: c.font.mono, fontWeight: 600, flexShrink: 0 }}>{pName}</Typography>
                                            <Typography sx={{ color: c.text.muted, fontSize: '0.68rem', fontFamily: c.font.mono }}>{pDef?.type || 'any'}</Typography>
                                            {schemaRequired.includes(pName) && <Chip label="required" size="small" sx={{ bgcolor: `${c.status.error}12`, color: c.status.error, fontSize: '0.55rem', height: 14, '& .MuiChip-label': { px: 0.4 } }} />}
                                            {pDef?.description && <Typography sx={{ color: c.text.ghost, fontSize: '0.68rem', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{pDef.description}</Typography>}
                                          </Box>
                                        ))}
                                      </Box>
                                    )}
                                  </Box>
                                );
                              })}
                            </Box>
                          )}
                        </Box>
                      </Collapse>
                    </Box>
                  );
                };

                const isDisabled = tool.enabled === false;

                // Defensive Reddit detection so onboarding hooks still attach when ig.id lookup fails (legacy/manual installs).
                const isReddit =
                  ig?.id === 'reddit' ||
                  tool.name?.toLowerCase() === 'reddit' ||
                  (tool.command || '').toLowerCase().includes('reddit');
                const isYoutube =
                  ig?.id === 'youtube' ||
                  tool.name?.toLowerCase() === 'youtube' ||
                  (tool.command || '').toLowerCase().includes('youtube');
                return (
                  <Card
                    key={tool.id}
                    sx={{ order: tool.auth_status === 'connected' ? 0 : 1, bgcolor: c.bg.surface, border: `1px solid ${isExpanded ? c.accent.primary : c.border.subtle}`, borderRadius: 2, boxShadow: c.shadow.sm, '&:hover': { borderColor: isDisabled ? c.border.subtle : c.accent.primary, boxShadow: isDisabled ? undefined : '0 0 0 1px rgba(174,86,48,0.12)' }, transition: 'border-color 0.2s, box-shadow 0.2s' }}
                  >
                    <CardContent sx={{ py: 1.5, px: 2, '&:last-child': { pb: 1.5 } }}>
                      <Box
                        sx={{ display: 'flex', alignItems: 'center', gap: 2, cursor: isDisabled ? 'default' : 'pointer' }}
                        data-onboarding={isYoutube ? 'actions-youtube-chevron' : isReddit ? 'actions-reddit-chevron' : undefined}
                        onClick={() => !isDisabled && setExpandedToolId(isExpanded ? null : tool.id)}
                      >
                        {ig && (
                          <Box sx={{
                            width: 36, height: 36, borderRadius: 2, display: 'flex', alignItems: 'center', justifyContent: 'center',
                            bgcolor: `${ig.color}18`, fontSize: '1.1rem', fontWeight: 700, color: ig.color, flexShrink: 0,
                            opacity: isDisabled ? 0.4 : 1, transition: 'opacity 0.2s',
                          }}>
                            {ig.icon}
                          </Box>
                        )}
                        <Box sx={{ flex: 1, minWidth: 0, opacity: isDisabled ? 0.4 : 1, transition: 'opacity 0.2s' }}>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 0.5 }}>
                            <Typography sx={{ color: c.text.primary, fontWeight: 600, fontSize: '0.95rem' }}>{tool.name}</Typography>
                            {isMcp && <Chip icon={<ExtensionIcon sx={{ fontSize: 12 }} />} label={isStdio ? 'MCP · stdio' : 'MCP'} size="small" sx={{ bgcolor: `${c.status.warning}20`, color: c.status.warning, fontSize: '0.75rem', height: 24 }} />}
                            {tool.command && <Chip icon={<TerminalIcon sx={{ fontSize: 12 }} />} label={`/${tool.command}`} size="small" sx={{ bgcolor: 'rgba(174,86,48,0.12)', color: c.accent.hover, fontSize: '0.72rem', height: 22 }} />}
                            {tool.auth_status === 'connected' && !ig && (
                              <Chip icon={<CheckCircleIcon sx={{ fontSize: 12 }} />} label={tool.connected_account_email ? `Connected · ${tool.connected_account_email}` : 'Connected'} size="small" sx={{ bgcolor: c.status.successBg, color: c.status.success, fontSize: '0.7rem', height: 20, '& .MuiChip-icon': { color: c.status.success } }} />
                            )}
                            {tool.auth_status === 'configured' && !ig?.credentialFields && (
                              <Chip icon={<SettingsIcon sx={{ fontSize: 12 }} />} label="Configured" size="small" sx={{ bgcolor: c.status.warningBg, color: c.status.warning, fontSize: '0.7rem', height: 20, '& .MuiChip-icon': { color: c.status.warning } }} />
                            )}
                            {ig && totalToolCount > 0 && (
                              <Chip label={`${totalToolCount} actions`} size="small" sx={{ bgcolor: `${ig.color}15`, color: ig.color, fontSize: '0.7rem', height: 20, '& .MuiChip-label': { px: 0.6 } }} />
                            )}
                            {ig && (
                              <Chip component="a" href={ig.website} clickable icon={<OpenInNewIcon sx={{ fontSize: 10 }} />} label="docs" size="small" sx={{ bgcolor: c.bg.secondary, color: c.text.ghost, fontSize: '0.65rem', height: 18, '& .MuiChip-label': { px: 0.4 }, '& .MuiChip-icon': { ml: 0.4, fontSize: 10 } }} />
                            )}
                          </Box>
                          {tool.description && <Typography sx={{ color: c.text.muted, fontSize: '0.84rem' }}>{tool.description}</Typography>}
                        </Box>
                        {!isDisabled && (tool.auth_type === 'oauth2' || ig?.authType === 'oauth2') && (tool.auth_status !== 'connected' || ig?.id === 'discord') && (
                          <Button
                            size="small"
                            variant="outlined"
                            startIcon={<LinkIcon sx={{ fontSize: 14 }} />}
                            onClick={(e) => { e.stopPropagation(); handleOAuthConnect(tool.id); }}
                            sx={{ borderColor: `${c.status.info}40`, color: c.status.info, '&:hover': { borderColor: c.status.info, bgcolor: `${c.status.info}10` }, textTransform: 'none', fontSize: '0.78rem', borderRadius: 1.5, py: 0.5, flexShrink: 0 }}
                          >
                            {ig?.id === 'discord' && tool.auth_status === 'connected' ? 'Add server' : `Connect ${tool.name}`}
                          </Button>
                        )}
                        {!isDisabled && ig?.authType === 'device_code' && tool.auth_status !== 'connected' && (
                          <Button
                            size="small"
                            variant="outlined"
                            startIcon={<LinkIcon sx={{ fontSize: 14 }} />}
                            onClick={(e) => { e.stopPropagation(); handleDeviceCodeConnect(tool.id); }}
                            sx={{ borderColor: `${ig.color}40`, color: ig.color, '&:hover': { borderColor: ig.color, bgcolor: `${ig.color}10` }, textTransform: 'none', fontSize: '0.78rem', borderRadius: 1.5, py: 0.5, flexShrink: 0 }}
                          >
                            Connect Microsoft 365
                          </Button>
                        )}
                        {!isDisabled && ig?.credentialFields && tool.auth_status !== 'connected' && (
                          <Button
                            size="small"
                            variant="outlined"
                            startIcon={<LinkIcon sx={{ fontSize: 14 }} />}
                            onClick={(e) => { e.stopPropagation(); openCredentialsDialog(tool.id, ig); }}
                            sx={{ borderColor: `${ig.color}40`, color: ig.color, '&:hover': { borderColor: ig.color, bgcolor: `${ig.color}10` }, textTransform: 'none', fontSize: '0.78rem', borderRadius: 1.5, py: 0.5, flexShrink: 0 }}
                          >
                            {ig.connectLabel || 'Connect'}
                          </Button>
                        )}
                        {!isDisabled && ig && tool.auth_status === 'connected' && (
                          <Tooltip title={ig.credentialFields || ig.authType === 'oauth2' || ig.authType === 'device_code' ? 'Disconnect' : ''}>
                            <Chip
                              icon={<CheckCircleIcon sx={{ fontSize: 12 }} />}
                              label={tool.connected_account_email ? `Connected · ${tool.connected_account_email}` : 'Connected'}
                              size="small"
                              onDelete={(ig.credentialFields || ig.authType === 'oauth2' || ig.authType === 'device_code') ? (e: React.SyntheticEvent) => { e.stopPropagation(); ig.authType === 'device_code' ? handleM365Disconnect(tool.id) : handleDisconnectIntegration(tool.id, ig); } : undefined}
                              onClick={(e) => e.stopPropagation()}
                              sx={{ bgcolor: c.status.successBg, color: c.status.success, fontSize: '0.7rem', height: 22, '& .MuiChip-icon': { color: c.status.success }, '& .MuiChip-deleteIcon': { color: c.status.success, '&:hover': { color: c.status.error } }, flexShrink: 0 }}
                            />
                          </Tooltip>
                        )}
                        {ig && (
                          <Box
                            data-onboarding={
                              isYoutube
                                ? 'actions-youtube-toggle'
                                : isReddit
                                  ? 'actions-reddit-toggle'
                                  : undefined
                            }
                            sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexShrink: 0 }}
                            onClick={(e) => e.stopPropagation()}
                          >
                            {!!integrationLoading[ig.id] && <CircularProgress size={16} sx={{ color: ig.color }} />}
                            <Switch
                              checked={tool.enabled !== false}
                              onChange={() => handleIntegrationToggle(ig)}
                              disabled={!!integrationLoading[ig.id]}
                              sx={{
                                '& .MuiSwitch-switchBase.Mui-checked': { color: ig.color },
                                '& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track': { bgcolor: ig.color },
                              }}
                            />
                          </Box>
                        )}
                        {!isDisabled && (
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25, flexShrink: 0 }}>
                            <KeyboardArrowDownIcon sx={{ fontSize: 18, color: c.text.ghost, transition: 'transform 0.2s', transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)' }} />
                            {!ig && (
                              <>
                                <Tooltip title="Edit" placement="left"><IconButton size="small" onClick={(e) => { e.stopPropagation(); openEdit(tool); }} sx={{ color: c.text.ghost, '&:hover': { color: c.accent.primary } }}><EditIcon sx={{ fontSize: 16 }} /></IconButton></Tooltip>
                                <Tooltip title="Delete" placement="left"><IconButton size="small" onClick={(e) => { e.stopPropagation(); handleDelete(tool.id); }} sx={{ color: c.text.ghost, '&:hover': { color: c.status.error } }}><DeleteIcon sx={{ fontSize: 16 }} /></IconButton></Tooltip>
                              </>
                            )}
                          </Box>
                        )}
                      </Box>
                    </CardContent>

                    <Collapse in={isExpanded && !isDisabled} timeout={0} unmountOnExit>
                        <Box sx={{ px: 2, pb: 2, pt: 0, borderTop: `1px solid ${c.border.subtle}` }}>
                          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mt: 1.5, mb: 1 }}>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                              <SecurityIcon sx={{ fontSize: 14, color: c.text.muted }} />
                              <Typography sx={{ color: c.text.muted, fontSize: '0.78rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Action Permissions</Typography>
                              {hasPerms && <Chip label={`${totalToolCount} actions`} size="small" sx={{ bgcolor: c.bg.secondary, color: c.text.ghost, fontSize: '0.65rem', height: 18, ml: 0.5, '& .MuiChip-label': { px: 0.6 } }} />}
                            </Box>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                              {hasPerms && (
                                <>
                                  <Tooltip title="Allow all read-only actions">
                                    <Button size="small" onClick={() => handleBulkReadOnly(tool.id)} sx={{ color: c.status.info, textTransform: 'none', fontSize: '0.7rem', minWidth: 'auto', px: 1, py: 0.25 }}>
                                      Allow reads
                                    </Button>
                                  </Tooltip>
                                  <Tooltip title="Reset all to Ask">
                                    <Button size="small" onClick={() => handleResetPermissions(tool.id)} sx={{ color: c.text.ghost, textTransform: 'none', fontSize: '0.7rem', minWidth: 'auto', px: 1, py: 0.25 }}>
                                      Reset
                                    </Button>
                                  </Tooltip>
                                </>
                              )}
                              <Tooltip title="Discover / refresh actions from MCP server">
                                <IconButton
                                  size="small"
                                  onClick={() => handleDiscover(tool.id)}
                                  disabled={discovering || !canDiscover}
                                  sx={{ color: c.text.ghost, '&:hover': { color: c.accent.primary } }}
                                >
                                  {discovering ? <CircularProgress size={14} sx={{ color: c.text.ghost }} /> : <RefreshIcon sx={{ fontSize: 16 }} />}
                                </IconButton>
                              </Tooltip>
                            </Box>
                          </Box>

                          {!hasPerms ? (
                            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', py: 3, gap: 1.5 }}>
                              <ExtensionIcon sx={{ fontSize: 28, color: c.text.ghost, opacity: 0.4 }} />
                              <Typography sx={{ color: c.text.ghost, fontSize: '0.82rem' }}>No actions discovered yet</Typography>
                              <Button
                                size="small"
                                variant="outlined"
                                startIcon={discovering ? <CircularProgress size={12} /> : <SearchIcon sx={{ fontSize: 14 }} />}
                                onClick={() => handleDiscover(tool.id)}
                                disabled={discovering || !canDiscover}
                                sx={{ borderColor: c.border.medium, color: c.text.secondary, '&:hover': { borderColor: c.accent.primary, color: c.accent.primary }, textTransform: 'none', fontSize: '0.78rem', borderRadius: 1.5 }}
                              >
                                Discover Actions
                              </Button>
                              {!canDiscover && (
                                <Typography sx={{ color: c.text.ghost, fontSize: '0.72rem' }}>Add an MCP configuration to enable action discovery</Typography>
                              )}
                            </Box>
                          ) : (
                            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
                              {serviceNames.map((svc, idx) => (
                                <ServiceGroup key={svc} serviceName={svc} data={services![svc]} isFirstGroup={idx === 0} />
                              ))}
                            </Box>
                          )}

                          {devMode && isMcp && (
                            <Box sx={{ mt: 2, pt: 1.5, borderTop: `1px solid ${c.border.subtle}`, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                              <Typography sx={{ color: c.text.muted, fontSize: '0.7rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                                Developer Info
                              </Typography>
                              <Box sx={{ bgcolor: c.bg.page, borderRadius: 1.5, border: `1px solid ${c.border.subtle}`, px: 1.5, py: 1 }}>
                                <Typography sx={{ color: c.text.ghost, fontSize: '0.68rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', mb: 0.5 }}>
                                  MCP Config
                                </Typography>
                                <Typography component="pre" sx={{ color: c.text.muted, fontSize: '0.75rem', fontFamily: c.font.mono, whiteSpace: 'pre-wrap', wordBreak: 'break-all', m: 0, lineHeight: 1.5 }}>
                                  {JSON.stringify(tool.mcp_config, null, 2)}
                                </Typography>
                              </Box>
                              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5 }}>
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                  <Typography sx={{ color: c.text.ghost, fontSize: '0.72rem' }}>Auth type:</Typography>
                                  <Typography sx={{ color: c.text.muted, fontSize: '0.72rem', fontFamily: c.font.mono }}>{tool.auth_type || 'none'}</Typography>
                                </Box>
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                  <Typography sx={{ color: c.text.ghost, fontSize: '0.72rem' }}>Status:</Typography>
                                  <Typography sx={{ color: c.text.muted, fontSize: '0.72rem', fontFamily: c.font.mono }}>{tool.auth_status || 'none'}</Typography>
                                </Box>
                                {tool.connected_account_email && (
                                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                    <Typography sx={{ color: c.text.ghost, fontSize: '0.72rem' }}>Account:</Typography>
                                    <Typography sx={{ color: c.text.muted, fontSize: '0.72rem', fontFamily: c.font.mono }}>{tool.connected_account_email}</Typography>
                                  </Box>
                                )}
                              </Box>
                              {tool.credentials && Object.keys(tool.credentials).length > 0 && (
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap' }}>
                                  <Typography sx={{ color: c.text.ghost, fontSize: '0.72rem' }}>Credentials:</Typography>
                                  {Object.keys(tool.credentials).map((key) => (
                                    <Chip key={key} label={`${key}: configured`} size="small" sx={{ bgcolor: `${c.status.success}12`, color: c.status.success, fontSize: '0.65rem', height: 18, fontFamily: c.font.mono, '& .MuiChip-label': { px: 0.6 } }} />
                                  ))}
                                </Box>
                              )}
                            </Box>
                          )}
                        </Box>
                      </Collapse>
                  </Card>
                );
              })}
            </Box>
          )}
        </Collapse>
      </Box>

      <ToolDialogs
        dialogOpen={dialogOpen}
        setDialogOpen={setDialogOpen}
        editingId={editingId}
        form={form}
        setForm={setForm}
        onSave={handleSave}
        mcpConfigOpen={mcpConfigOpen}
        setMcpConfigOpen={setMcpConfigOpen}
        mcpConfigServer={mcpConfigServer}
        mcpConfigJson={mcpConfigJson}
        setMcpConfigJson={setMcpConfigJson}
        mcpConfigError={mcpConfigError}
        setMcpConfigError={setMcpConfigError}
        mcpAuthType={mcpAuthType}
        setMcpAuthType={setMcpAuthType}
        mcpCredentials={mcpCredentials}
        setMcpCredentials={setMcpCredentials}
        onMcpConfigSave={handleMcpConfigSave}
        deviceCodeDialogOpen={deviceCodeDialogOpen}
        setDeviceCodeDialogOpen={setDeviceCodeDialogOpen}
        deviceCodeStatus={deviceCodeStatus}
        deviceCodeUrl={deviceCodeUrl}
        deviceCode={deviceCode}
        credDialogOpen={credDialogOpen}
        setCredDialogOpen={setCredDialogOpen}
        credDialogIntegration={credDialogIntegration}
        credDialogValues={credDialogValues}
        setCredDialogValues={setCredDialogValues}
        credDialogSaving={credDialogSaving}
        onSlackAutoConnect={handleSlackAutoConnect}
        onCredentialsSave={handleCredentialsSave}
      />

      <RegistryBrowserDialog
        open={registryOpen}
        onClose={() => setRegistryOpen(false)}
        regStats={regStats}
        regSource={regSource}
        devMode={devMode}
        regQuery={regQuery}
        onRegSearch={handleRegSearch}
        regSort={regSort}
        onRegSort={handleRegSort}
        onRegSourceFilter={handleRegSourceFilter}
        regLoading={regLoading}
        regServers={regServers}
        regTotal={regTotal}
        allTools={allTools}
        expandedServer={expandedServer}
        onExpandServer={(srv, next) => {
          setExpandedServer(next);
          if (next && devMode) {
            dispatch(clearDetail());
            dispatch(fetchServerDetail(srv.name));
          }
        }}
        regDetail={regDetail}
        regDetailLoading={regDetailLoading}
        onInstall={handleInstall}
        onEditInstall={handleEditInstall}
        onLoadMore={handleLoadMore}
      />

      <Snackbar
        open={snackbar.open}
        autoHideDuration={3000}
        onClose={() => setSnackbar({ open: false, message: '' })}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert onClose={() => setSnackbar({ open: false, message: '' })} severity={snackbar.severity || 'success'} sx={{ bgcolor: snackbar.severity === 'error' ? '#2e1a1a' : c.status.successBg, color: snackbar.severity === 'error' ? '#f87171' : c.status.success, border: `1px solid ${snackbar.severity === 'error' ? '#ef444440' : `${c.status.success}40`}` }}>
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Box>
  );
};

export default Tools;
