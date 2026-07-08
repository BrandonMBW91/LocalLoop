import { useState, useDeferredValue } from 'react';

// Shared UI state for the three feed screens (events / garage sales / food
// trucks): the search query (deferred so typing stays smooth on big lists), the
// active category/item filter, an optional secondary toggle (This Week / Today),
// and pull-to-refresh. Each screen layers its own filter PREDICATE on top of this;
// this hook only owns the state plus the isFiltering / clearFilters helpers so
// every list handles "clear your filters" the same way.
export function useListState({ refresh, initialFilter = 'All' }) {
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const [activeFilter, setActiveFilter] = useState(initialFilter);
  const [toggle, setToggle] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await refresh();
    } finally {
      setRefreshing(false);
    }
  };

  const isFiltering =
    activeFilter !== initialFilter || toggle || query.trim().length > 0;
  const clearFilters = () => {
    setActiveFilter(initialFilter);
    setToggle(false);
    setQuery('');
  };

  return {
    query,
    setQuery,
    deferredQuery,
    activeFilter,
    setActiveFilter,
    toggle,
    setToggle,
    refreshing,
    onRefresh,
    isFiltering,
    clearFilters,
  };
}
