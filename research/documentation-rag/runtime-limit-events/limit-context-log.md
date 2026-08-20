# Runtime Limit Context Log

This file is generated automatically whenever Project Gauss hits constrained or critical runtime limits.
It exists so local RAG can retrieve truthful recent operating context instead of reasoning from stale assumptions.

## Operating Rule
- Record limits truthfully.
- Prefer deterministic degradation over invented recovery.
- Use these events as bounded evidence for later diagnosis, not as proof that a repair has already succeeded.

Generated at: 2026-08-20T12:06:21.947Z

## 2026-08-20T12:06:21.947Z · MEMORY · CRITICAL · health
- Free MB: 91.63
- SVG-lite forced: yes
- Ceiling overrun: no
- Signals: free-mb-critical
- Suspended subsystems: rag-refresh, optional-enrichers, startup-chat-check, background-reconcile, projection-refresh
- Detail: `{   "route": "/health" }`

## 2026-08-20T12:05:51.812Z · MEMORY · CRITICAL · ingest-loop
- Free MB: 150
- SVG-lite forced: yes
- Ceiling overrun: no
- Signals: free-mb-critical
- Suspended subsystems: rag-refresh, optional-enrichers, startup-chat-check, background-reconcile, projection-refresh
- Detail: `{   "operation": "tick" }`

## 2026-08-20T12:05:51.476Z · MEMORY · CRITICAL · startup
- Free MB: 153.59
- SVG-lite forced: yes
- Ceiling overrun: no
- Signals: free-mb-critical
- Suspended subsystems: rag-refresh, optional-enrichers, startup-chat-check, background-reconcile, projection-refresh
- Detail: `{   "route": "server.listen" }`

## 2026-08-20T12:02:25.611Z · MEMORY · CRITICAL · health
- Free MB: 139.91
- SVG-lite forced: yes
- Ceiling overrun: no
- Signals: free-mb-critical
- Suspended subsystems: rag-refresh, optional-enrichers, startup-chat-check, background-reconcile, projection-refresh
- Detail: `{   "route": "/health" }`

## 2026-08-20T12:01:58.110Z · MEMORY · CRITICAL · ingest-loop
- Free MB: 159.41
- SVG-lite forced: yes
- Ceiling overrun: no
- Signals: free-mb-critical
- Suspended subsystems: rag-refresh, optional-enrichers, startup-chat-check, background-reconcile, projection-refresh
- Detail: `{   "operation": "tick" }`

## 2026-08-20T12:01:57.666Z · MEMORY · CRITICAL · startup
- Free MB: 159.41
- SVG-lite forced: yes
- Ceiling overrun: no
- Signals: free-mb-critical
- Suspended subsystems: rag-refresh, optional-enrichers, startup-chat-check, background-reconcile, projection-refresh
- Detail: `{   "route": "server.listen" }`

## 2026-08-20T11:50:28.960Z · MEMORY · CRITICAL · health
- Free MB: 116.19
- SVG-lite forced: yes
- Ceiling overrun: no
- Signals: free-mb-critical
- Suspended subsystems: rag-refresh, optional-enrichers, startup-chat-check, background-reconcile, projection-refresh
- Detail: `{   "route": "/health" }`

## 2026-08-20T11:49:31.212Z · MEMORY · CRITICAL · ingest-loop
- Free MB: 109.67
- SVG-lite forced: yes
- Ceiling overrun: no
- Signals: free-mb-critical
- Suspended subsystems: rag-refresh, optional-enrichers, startup-chat-check, background-reconcile, projection-refresh
- Detail: `{   "operation": "tick" }`

## 2026-08-20T11:49:30.803Z · MEMORY · CRITICAL · startup
- Free MB: 107.98
- SVG-lite forced: yes
- Ceiling overrun: no
- Signals: free-mb-critical
- Suspended subsystems: rag-refresh, optional-enrichers, startup-chat-check, background-reconcile, projection-refresh
- Detail: `{   "route": "server.listen" }`

## 2026-08-20T11:48:33.625Z · MEMORY · CRITICAL · ingest-loop
- Free MB: 144.66
- SVG-lite forced: yes
- Ceiling overrun: no
- Signals: free-mb-critical
- Suspended subsystems: rag-refresh, optional-enrichers, startup-chat-check, background-reconcile, projection-refresh
- Detail: `{   "operation": "tick" }`

## 2026-08-20T11:48:33.525Z · MEMORY · CRITICAL · startup
- Free MB: 144.66
- SVG-lite forced: yes
- Ceiling overrun: no
- Signals: free-mb-critical
- Suspended subsystems: rag-refresh, optional-enrichers, startup-chat-check, background-reconcile, projection-refresh
- Detail: `{   "route": "server.listen" }`

## 2026-08-20T11:47:33.836Z · MEMORY · CRITICAL · health
- Free MB: 153.72
- SVG-lite forced: yes
- Ceiling overrun: no
- Signals: free-mb-critical
- Suspended subsystems: rag-refresh, optional-enrichers, startup-chat-check, background-reconcile, projection-refresh
- Detail: `{   "route": "/health" }`

## 2026-08-20T11:47:04.408Z · THROTTLE · CRITICAL · ingest-cadence
- Free MB: 208.05
- SVG-lite forced: yes
- Ceiling overrun: no
- Signals: free-mb-critical
- Suspended subsystems: rag-refresh, optional-enrichers, startup-chat-check, background-reconcile, projection-refresh
- Detail: `{   "cadenceMs": 7500,   "key": "cleanup-rpc",   "reason": "upstream fetch held until cadence expires" }`

## 2026-08-20T11:47:04.396Z · THROTTLE · CRITICAL · ingest-cadence
- Free MB: 208.25
- SVG-lite forced: yes
- Ceiling overrun: no
- Signals: free-mb-critical
- Suspended subsystems: rag-refresh, optional-enrichers, startup-chat-check, background-reconcile, projection-refresh
- Detail: `{   "cadenceMs": 7500,   "key": "source-health-write",   "reason": "upstream fetch held until cadence expires" }`

## 2026-08-20T11:40:47.291Z · MEMORY · CRITICAL · ingest-loop
- Free MB: 80.03
- SVG-lite forced: yes
- Ceiling overrun: no
- Signals: free-mb-critical
- Suspended subsystems: rag-refresh, optional-enrichers, startup-chat-check, background-reconcile, projection-refresh
- Detail: `{   "operation": "tick" }`

## 2026-08-20T11:30:44.935Z · MEMORY · CRITICAL · ingest-loop
- Free MB: 102.34
- SVG-lite forced: yes
- Ceiling overrun: no
- Signals: free-mb-critical
- Suspended subsystems: rag-refresh, optional-enrichers, startup-chat-check, background-reconcile, projection-refresh
- Detail: `{   "operation": "tick" }`

## 2026-08-20T11:20:42.090Z · MEMORY · CRITICAL · ingest-loop
- Free MB: 61.86
- SVG-lite forced: yes
- Ceiling overrun: no
- Signals: free-mb-critical
- Suspended subsystems: rag-refresh, optional-enrichers, startup-chat-check, background-reconcile, projection-refresh
- Detail: `{   "operation": "tick" }`

## 2026-08-20T11:10:40.076Z · MEMORY · CRITICAL · ingest-loop
- Free MB: 165.02
- SVG-lite forced: yes
- Ceiling overrun: no
- Signals: free-mb-critical
- Suspended subsystems: rag-refresh, optional-enrichers, startup-chat-check, background-reconcile, projection-refresh
- Detail: `{   "operation": "tick" }`

## 2026-08-20T10:58:15.355Z · MEMORY · CRITICAL · ingest-loop
- Free MB: 97.89
- SVG-lite forced: yes
- Ceiling overrun: no
- Signals: free-mb-critical
- Suspended subsystems: rag-refresh, optional-enrichers, startup-chat-check, background-reconcile, projection-refresh
- Detail: `{   "operation": "tick" }`

## 2026-08-20T10:39:06.614Z · MEMORY · CRITICAL · ingest-loop
- Free MB: 105.38
- SVG-lite forced: yes
- Ceiling overrun: no
- Signals: free-mb-critical
- Suspended subsystems: rag-refresh, optional-enrichers, startup-chat-check, background-reconcile, projection-refresh
- Detail: `{   "operation": "tick" }`

## 2026-08-20T10:20:41.255Z · MEMORY · CRITICAL · ingest-loop
- Free MB: 182.77
- SVG-lite forced: yes
- Ceiling overrun: no
- Signals: free-mb-critical
- Suspended subsystems: rag-refresh, optional-enrichers, startup-chat-check, background-reconcile, projection-refresh
- Detail: `{   "operation": "tick" }`

## 2026-08-20T10:09:19.416Z · MEMORY · CRITICAL · ingest-loop
- Free MB: 86.02
- SVG-lite forced: yes
- Ceiling overrun: no
- Signals: free-mb-critical
- Suspended subsystems: rag-refresh, optional-enrichers, startup-chat-check, background-reconcile, projection-refresh
- Detail: `{   "operation": "tick" }`

## 2026-08-20T09:56:07.015Z · MEMORY · CRITICAL · ingest-loop
- Free MB: 121.25
- SVG-lite forced: yes
- Ceiling overrun: no
- Signals: free-mb-critical
- Suspended subsystems: rag-refresh, optional-enrichers, startup-chat-check, background-reconcile, projection-refresh
- Detail: `{   "operation": "tick" }`

## 2026-08-20T09:46:05.014Z · MEMORY · CRITICAL · ingest-loop
- Free MB: 117.06
- SVG-lite forced: yes
- Ceiling overrun: no
- Signals: free-mb-critical
- Suspended subsystems: rag-refresh, optional-enrichers, startup-chat-check, background-reconcile, projection-refresh
- Detail: `{   "operation": "tick" }`

## 2026-08-20T09:40:28.528Z · MEMORY · CRITICAL · health
- Free MB: 99.75
- SVG-lite forced: yes
- Ceiling overrun: no
- Signals: free-mb-critical
- Suspended subsystems: rag-refresh, optional-enrichers, startup-chat-check, background-reconcile, projection-refresh
- Detail: `{   "route": "/health" }`

## 2026-08-20T09:36:02.707Z · MEMORY · CRITICAL · ingest-loop
- Free MB: 156.47
- SVG-lite forced: yes
- Ceiling overrun: no
- Signals: free-mb-critical
- Suspended subsystems: rag-refresh, optional-enrichers, startup-chat-check, background-reconcile, projection-refresh
- Detail: `{   "operation": "tick" }`

## 2026-08-20T09:36:02.599Z · MEMORY · CRITICAL · startup
- Free MB: 135.27
- SVG-lite forced: yes
- Ceiling overrun: no
- Signals: free-mb-critical
- Suspended subsystems: rag-refresh, optional-enrichers, startup-chat-check, background-reconcile, projection-refresh
- Detail: `{   "route": "server.listen" }`

## 2026-08-20T08:54:18.903Z · MEMORY · CRITICAL · worker-registry
- Free MB: 164.69
- SVG-lite forced: yes
- Ceiling overrun: no
- Signals: free-mb-critical
- Suspended subsystems: rag-refresh, optional-enrichers, startup-chat-check, background-reconcile, projection-refresh
- Detail: `{   "worker": "command-planner" }`

## 2026-08-20T08:54:18.890Z · MEMORY · CRITICAL · worker-broker
- Free MB: 164.69
- SVG-lite forced: yes
- Ceiling overrun: no
- Signals: free-mb-critical
- Suspended subsystems: rag-refresh, optional-enrichers, startup-chat-check, background-reconcile, projection-refresh
- Detail: `{   "operation": "list-workers" }`

## 2026-08-20T08:54:18.877Z · MEMORY · CRITICAL · worker-registry
- Free MB: 164.69
- SVG-lite forced: yes
- Ceiling overrun: no
- Signals: free-mb-critical
- Suspended subsystems: rag-refresh, optional-enrichers, startup-chat-check, background-reconcile, projection-refresh
- Detail: `{   "worker": "ssa-analysis" }`

## 2026-08-20T08:54:18.863Z · MEMORY · CRITICAL · worker-broker
- Free MB: 164.69
- SVG-lite forced: yes
- Ceiling overrun: no
- Signals: free-mb-critical
- Suspended subsystems: rag-refresh, optional-enrichers, startup-chat-check, background-reconcile, projection-refresh
- Detail: `{   "operation": "dispatch" }`

## 2026-08-20T08:54:18.667Z · MEMORY · CRITICAL · undefined
- Free MB: 164.69
- SVG-lite forced: yes
- Ceiling overrun: no
- Signals: free-mb-critical
- Suspended subsystems: rag-refresh, optional-enrichers, startup-chat-check, background-reconcile, projection-refresh
- Detail: none

## 2026-08-20T08:54:18.640Z · MEMORY · CRITICAL · ssa-route
- Free MB: 164.69
- SVG-lite forced: yes
- Ceiling overrun: no
- Signals: free-mb-critical
- Suspended subsystems: rag-refresh, optional-enrichers, startup-chat-check, background-reconcile, projection-refresh
- Detail: `{   "route": "/api/ssa/seven-zone" }`

## 2026-08-20T08:54:18.608Z · MEMORY · CRITICAL · ssa-route
- Free MB: 164.69
- SVG-lite forced: yes
- Ceiling overrun: no
- Signals: free-mb-critical
- Suspended subsystems: rag-refresh, optional-enrichers, startup-chat-check, background-reconcile, projection-refresh
- Detail: `{   "route": "/api/ssa/space-domain" }`

## 2026-08-20T08:54:16.808Z · THROTTLE · CRITICAL · ingest-cadence
- Free MB: 141.7
- SVG-lite forced: yes
- Ceiling overrun: no
- Signals: free-mb-critical
- Suspended subsystems: rag-refresh, optional-enrichers, startup-chat-check, background-reconcile, projection-refresh
- Detail: `{   "cadenceMs": 5000,   "key": "mms",   "reason": "upstream fetch held until cadence expires" }`

## 2026-08-20T08:54:16.803Z · THROTTLE · CRITICAL · ingest-cadence
- Free MB: 142.19
- SVG-lite forced: yes
- Ceiling overrun: no
- Signals: free-mb-critical
- Suspended subsystems: rag-refresh, optional-enrichers, startup-chat-check, background-reconcile, projection-refresh
- Detail: `{   "cadenceMs": 60000,   "key": "noaa",   "reason": "upstream fetch held until cadence expires" }`

## 2026-08-20T08:54:16.752Z · MEMORY · CRITICAL · ingest-loop
- Free MB: 142.83
- SVG-lite forced: yes
- Ceiling overrun: no
- Signals: free-mb-critical
- Suspended subsystems: rag-refresh, optional-enrichers, startup-chat-check, background-reconcile, projection-refresh
- Detail: `{   "operation": "tick" }`

## 2026-08-20T08:54:16.324Z · MEMORY · CRITICAL · ingest-loop
- Free MB: 132.81
- SVG-lite forced: yes
- Ceiling overrun: no
- Signals: free-mb-critical
- Suspended subsystems: rag-refresh, optional-enrichers, startup-chat-check, background-reconcile, projection-refresh
- Detail: `{   "operation": "tick" }`

## 2026-08-20T08:53:41.585Z · MEMORY · CRITICAL · undefined
- Free MB: 160.92
- SVG-lite forced: yes
- Ceiling overrun: no
- Signals: free-mb-critical
- Suspended subsystems: rag-refresh, optional-enrichers, startup-chat-check, background-reconcile, projection-refresh
- Detail: none

## 2026-08-20T08:53:41.560Z · MEMORY · CRITICAL · ssa-route
- Free MB: 160.92
- SVG-lite forced: yes
- Ceiling overrun: no
- Signals: free-mb-critical
- Suspended subsystems: rag-refresh, optional-enrichers, startup-chat-check, background-reconcile, projection-refresh
- Detail: `{   "route": "/api/ssa/seven-zone" }`

