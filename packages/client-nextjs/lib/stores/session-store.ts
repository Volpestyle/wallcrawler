import { create } from "zustand";
import { devtools, persist } from "zustand/middleware";
import { Session } from "@/lib/types/stagehand";
import { StagehandClient } from "@/lib/api/stagehand-client";
import { WallcrawlerClient, WallcrawlerSession } from "@/lib/api/wallcrawler-client-browser";

interface SessionState {
  // State
  sessions: Session[];
  activeSessionId: string | null;
  clients: Map<string, StagehandClient>;
  wallcrawlerClient: WallcrawlerClient | null;
  isLoading: boolean;
  error: string | null;
  useWallcrawler: boolean;

  // Actions
  addSession: (url: string, name: string) => Promise<Session | null>;
  removeSession: (sessionId: string) => Promise<void>;
  setActiveSession: (sessionId: string | null) => void;
  getClient: (sessionId: string) => StagehandClient | undefined;
  refreshSessions: () => Promise<void>;
  clearError: () => void;
  setUseWallcrawler: (useWallcrawler: boolean) => void;
  initializeWallcrawler: () => void;
}

export const useSessionStore = create<SessionState>()(
  devtools(
    persist(
      (set, get) => ({
        // Initial state
        sessions: [],
        activeSessionId: null,
        clients: new Map(),
        wallcrawlerClient: null,
        isLoading: false,
        error: null,
        useWallcrawler: false,

        // Add a new session
        addSession: async (url: string, name: string) => {
          set({ isLoading: true, error: null });
          try {
            const { useWallcrawler, wallcrawlerClient } = get();
            
            if (useWallcrawler) {
              // Use Wallcrawler
              if (!wallcrawlerClient) {
                set({ error: "Wallcrawler client not initialized", isLoading: false });
                return null;
              }
              
              const response = await wallcrawlerClient.createSession(name);
              
              if (response.success && response.data) {
                const session = response.data;
                
                set((state) => ({
                  sessions: [...state.sessions, session],
                  activeSessionId: session.id,
                  isLoading: false,
                }));
                
                return session;
              } else {
                set({ error: response.error || "Failed to create Wallcrawler session", isLoading: false });
                return null;
              }
            } else {
              // Use local Stagehand
              const client = new StagehandClient(url);
              const response = await client.createSession(name);
              
              if (response.success && response.data) {
                const session = response.data;
                const clients = new Map(get().clients);
                clients.set(session.id, client);
                
                set((state) => ({
                  sessions: [...state.sessions, session],
                  clients,
                  activeSessionId: session.id,
                  isLoading: false,
                }));
                
                return session;
              } else {
                set({ error: response.error || "Failed to create session", isLoading: false });
                return null;
              }
            }
          } catch (error) {
            set({
              error: error instanceof Error ? error.message : "Failed to create session",
              isLoading: false,
            });
            return null;
          }
        },

        // Remove a session
        removeSession: async (sessionId: string) => {
          set({ isLoading: true, error: null });
          try {
            const { useWallcrawler, wallcrawlerClient } = get();
            
            if (useWallcrawler && wallcrawlerClient) {
              await wallcrawlerClient.closeSession(sessionId);
            } else {
              const client = get().clients.get(sessionId);
              if (client) {
                await client.closeSession(sessionId);
              }
              
              const clients = new Map(get().clients);
              clients.delete(sessionId);
              
              set((state) => ({
                sessions: state.sessions.filter((s) => s.id !== sessionId),
                clients,
                activeSessionId: state.activeSessionId === sessionId ? null : state.activeSessionId,
                isLoading: false,
              }));
              return;
            }
            
            set((state) => ({
              sessions: state.sessions.filter((s) => s.id !== sessionId),
              activeSessionId: state.activeSessionId === sessionId ? null : state.activeSessionId,
              isLoading: false,
            }));
          } catch (error) {
            set({
              error: error instanceof Error ? error.message : "Failed to remove session",
              isLoading: false,
            });
          }
        },

        // Set active session
        setActiveSession: (sessionId: string | null) => {
          set({ activeSessionId: sessionId });
        },

        // Get client for a session
        getClient: (sessionId: string) => {
          return get().clients.get(sessionId);
        },

        // Refresh all sessions
        refreshSessions: async () => {
          set({ isLoading: true, error: null });
          try {
            const { sessions, clients } = get();
            const updatedSessions: Session[] = [];
            
            for (const session of sessions) {
              const client = clients.get(session.id);
              if (client) {
                const response = await client.getSession(session.id);
                if (response.success && response.data) {
                  updatedSessions.push(response.data);
                }
              }
            }
            
            set({ sessions: updatedSessions, isLoading: false });
          } catch (error) {
            set({
              error: error instanceof Error ? error.message : "Failed to refresh sessions",
              isLoading: false,
            });
          }
        },

        // Clear error
        clearError: () => {
          set({ error: null });
        },

        // Set whether to use Wallcrawler
        setUseWallcrawler: (useWallcrawler: boolean) => {
          set({ useWallcrawler });
          if (useWallcrawler) {
            get().initializeWallcrawler();
          }
        },

        // Initialize Wallcrawler client
        initializeWallcrawler: () => {
          if (!get().wallcrawlerClient) {
            set({ wallcrawlerClient: new WallcrawlerClient() });
          }
        },
      }),
      {
        name: "session-storage",
        partialize: (state) => ({
          sessions: state.sessions,
          activeSessionId: state.activeSessionId,
        }),
      }
    )
  )
);