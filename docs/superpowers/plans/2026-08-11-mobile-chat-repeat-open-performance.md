# Mobile Chat Repeat-Open Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep small chats and chat catalogs warm across repeated navigation while replacing screen-scoped Android SSE churn with one app-scoped stream.

**Architecture:** The existing memory-weighted conversation cache keeps its 2 MB ceiling but admits more lightweight entries. A single transport owned by `AppProvider` reads the daemon's global CDC stream and publishes conversation changes to session subscribers. A small bounded TTL cache single-flights Skills and Turn Settings catalog reads.

**Tech Stack:** React Native, Expo fetch streaming, React hooks, AsyncStorage, TypeScript, Vitest.

## Global Constraints

- Keep the conversation live-page cache at or below 2 MB retained estimated weight.
- Retain only live pages; user-loaded historical pages are never cached globally.
- Maintain one global `/api/v1/events` stream per active server configuration.
- A screen subscriber receives only events for its session.
- Catalog results expire after 30 seconds and remain bounded to 16 sessions.
- Supporting docs stay local-only and are not committed.
- Do not commit implementation until physical-device verification is complete.

---

### Task 1: Retain More Lightweight Conversations

**Files:**
- Modify: `packages/mobile/lib/chat/useConversation.ts`
- Test: `packages/mobile/lib/chat/snapshot.test.ts`

**Interfaces:**
- Consumes: `createConversationPageCache(maxEntries, maxWeight)`
- Produces: a live-page cache allowing up to 16 session entries under the existing 2 MB weight limit.

- [ ] Add a cache behavior test proving three lightweight pages survive when the entry limit permits them.
- [ ] Run `npm test -- --run lib/chat/snapshot.test.ts` and verify the singleton configuration contract fails before implementation.
- [ ] Change the mobile singleton to `createConversationPageCache(16, 2 * 1024 * 1024)`.
- [ ] Run the focused test and `npm run typecheck`.

### Task 2: Share One App-Scoped Conversation Event Stream

**Files:**
- Create: `packages/mobile/lib/chat/conversationEvents.ts`
- Create: `packages/mobile/lib/chat/conversationEvents.test.ts`
- Modify: `packages/mobile/lib/chat/api.ts`
- Modify: `packages/mobile/lib/chat/useConversation.ts`
- Modify: `packages/mobile/lib/store.tsx`
- Modify: `packages/mobile/lib/chatModeApi.test.ts`

**Interfaces:**
- Produces: `subscribeConversationEvents(sessionId, listener): () => void`.
- Produces: `useConversationEventTransport(config): void`, mounted once by `AppProvider`.
- Produces: `streamConversationEvents(config, after, signal, onEvent): Promise<number>` delivering the global stream without screen-level filtering.

- [ ] Write failing registry tests proving publication is session-scoped and unsubscribe removes a listener.
- [ ] Write a failing API boundary test proving the global stream delivers events from different sessions to the transport.
- [ ] Run the focused tests and confirm expected failures.
- [ ] Implement a session-listener registry and the app-scoped reconnect loop with one global AsyncStorage cursor and coalesced persistence.
- [ ] Mount the transport from `AppProvider`.
- [ ] Replace the screen-scoped stream effect in `useMobileConversation` with a registry subscription that schedules authoritative refreshes.
- [ ] Ensure stream readers are cancelled/released in `finally` when aborted.
- [ ] Run focused tests and `npm run typecheck`.

### Task 3: Single-Flight and Cache Chat Catalogs

**Files:**
- Create: `packages/mobile/lib/chat/asyncValueCache.ts`
- Create: `packages/mobile/lib/chat/asyncValueCache.test.ts`
- Modify: `packages/mobile/lib/chat/useConversation.ts`

**Interfaces:**
- Produces: `createAsyncValueCache<K, V>(maxEntries, ttlMs, now?)` with `load`, `set`, and `delete`.
- Consumes: the conversation server/session cache key.
- Produces: bounded 30-second caches for Turn Settings and Skills.

- [ ] Write failing tests proving concurrent loads share one promise, warm loads reuse a value, expired loads refetch, and LRU eviction stays bounded.
- [ ] Run the focused test and confirm expected failures.
- [ ] Implement the minimal generic cache.
- [ ] Route `loadTurnOptions` and `loadSkills` through module-level 16-entry caches.
- [ ] Update the Turn Settings cache after a config option mutation and invalidate Skills when MCP servers reload.
- [ ] Run focused tests and `npm run typecheck`.

### Task 4: Verify the Complete Mobile Batch

**Files:**
- Verify all modified mobile files.

- [ ] Run `npm test` from `packages/mobile`.
- [ ] Run `npm run typecheck` from `packages/mobile`.
- [ ] Run `git diff --check` from the repository root.
- [ ] Confirm local-only docs, `package-lock.json` formatting churn, screenshots, and unrelated untracked files remain unstaged.
- [ ] Hand off a physical Android test sequence: open at least five alternating small and large chats, test Back immediately, reopen Skills and Turn Settings, and load history.
