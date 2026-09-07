import React, { createContext, useContext, useMemo, type PropsWithChildren } from 'react';
import { createActivityBus, type ActivityBus } from './activityBus';

const ActivityBusContext = createContext<ActivityBus | undefined>(undefined);

export interface ActivityBusProviderProps {
  /** Supplied by tests that want to publish or observe directly; the app creates its own. */
  bus?: ActivityBus;
}

/** Sits above the coordinators so every one of them publishes to the same bus. */
export function ActivityBusProvider({
  bus,
  children,
}: PropsWithChildren<ActivityBusProviderProps>): React.JSX.Element {
  const value = useMemo(() => bus ?? createActivityBus(), [bus]);
  return (
    <ActivityBusContext.Provider value={value}>{children}</ActivityBusContext.Provider>
  );
}

export function useActivityBus(): ActivityBus {
  const value = useContext(ActivityBusContext);
  if (value === undefined) {
    throw new Error('useActivityBus must be used within an ActivityBusProvider');
  }
  return value;
}
