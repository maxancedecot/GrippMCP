import { Suspense, type ReactNode } from "react";
import { AccountManagerInitialLoadingBoundary } from "./initial-loading.js";

export default function AccountManagerLayout({ children }: { children: ReactNode }) {
  return <AccountManagerInitialLoadingBoundary><Suspense fallback={null}>{children}</Suspense></AccountManagerInitialLoadingBoundary>;
}
