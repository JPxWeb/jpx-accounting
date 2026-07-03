"use client";

import { DEFAULT_WORKSPACE_PROFILE, type WorkspaceProfile } from "@jpx-accounting/contracts";
import { useQuery } from "@tanstack/react-query";
import { createContext, type ReactNode, useContext } from "react";

import { apiClient } from "../../lib/client";

const WorkspaceProfileContext = createContext<WorkspaceProfile>(DEFAULT_WORKSPACE_PROFILE);

/**
 * Serves the workspace profile (country/locale/currency/fiscal year) to every
 * client component. Shares the `company-settings` query key with the company
 * settings form, so a successful save updates rendered formatting live via
 * `queryClient.setQueryData`.
 */
export function WorkspaceProfileProvider({ children }: { children: ReactNode }) {
  const { data } = useQuery({
    queryKey: ["company-settings"],
    queryFn: () => apiClient.getCompanySettings(),
  });

  return (
    <WorkspaceProfileContext.Provider value={data?.profile ?? DEFAULT_WORKSPACE_PROFILE}>
      {children}
    </WorkspaceProfileContext.Provider>
  );
}

export function useWorkspaceProfile(): WorkspaceProfile {
  return useContext(WorkspaceProfileContext);
}
