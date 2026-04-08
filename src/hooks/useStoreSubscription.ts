import { useEffect, useRef } from "react";
import { subscribeToStoreChanges, type StoreScope } from "@/lib/store";

export function useStoreSubscription(scopes: StoreScope[], onChange: () => void) {
  const onChangeRef = useRef(onChange);
  const scopeKey = scopes.slice().sort().join("|");

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    const scopeSet = new Set(scopes);

    return subscribeToStoreChanges((scope) => {
      if (!scopeSet.has(scope)) return;
      onChangeRef.current();
    });
  }, [scopeKey]);
}