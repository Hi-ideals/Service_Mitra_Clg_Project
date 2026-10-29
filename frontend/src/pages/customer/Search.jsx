import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { Search as SearchIcon, SlidersHorizontal, MapPin, SearchX } from 'lucide-react';
import { api } from '../../lib/api.js';
import { keys } from '../../lib/queryClient.js';
import useDebounce from '../../hooks/useDebounce.js';
import { useToast } from '../../context/ToastContext.jsx';
import ProviderCard from './ProviderCard.jsx';
import SearchFilters from './SearchFilters.jsx';
import Button from '../../components/ui/Button.jsx';
import Modal from '../../components/ui/Modal.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import Pagination from '../../components/ui/Pagination.jsx';
import Alert from '../../components/ui/Alert.jsx';
import { SkeletonGrid } from '../../components/ui/Skeleton.jsx';
import useDocumentTitle from '../../hooks/useDocumentTitle.js';

/**
 * Filters live in the URL, not in component state.
 *
 * That makes a filtered search shareable, bookmarkable and survivable across
 * the back button - all of which a customer comparing providers will do.
 */
function readFilters(params) {
  const asNumber = (key) => (params.get(key) ? Number(params.get(key)) : undefined);
  return {
    q: params.get('q') || undefined,
    category: params.get('category') || undefined,
    pincode: params.get('pincode') || undefined,
    minRating: asNumber('minRating'),
    maxPriceMinor: asNumber('maxPriceMinor'),
    sort: params.get('sort') || 'relevance',
    lat: asNumber('lat'),
    lng: asNumber('lng'),
    page: asNumber('page') || 1,
  };
}

function toParams(filters) {
  const params = {};
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === null || value === '') continue;
    if (key === 'page' && Number(value) <= 1) continue;
    if (key === 'sort' && value === 'relevance') continue;
    params[key] = String(value);
  }
  return params;
}

export default function Search() {
  useDocumentTitle('Find a professional');
  const [searchParams, setSearchParams] = useSearchParams();
  const filters = useMemo(() => readFilters(searchParams), [searchParams]);
  const toast = useToast();

  const [term, setTerm] = useState(filters.q || '');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const debouncedTerm = useDebounce(term, 400);

  const { data: categories } = useQuery({
    queryKey: keys.categories.tree,
    queryFn: async () => (await api.get('/categories/tree')).data,
    staleTime: 10 * 60_000,
  });

  const query = { ...filters, q: debouncedTerm || undefined };

  const { data, isLoading, isFetching, error } = useQuery({
    queryKey: keys.providers.search(query),
    queryFn: () => {
      const { category, ...rest } = query;
      return api.get('/providers/search', {
        params: { ...rest, categorySlug: category, limit: 12 },
      });
    },
    // Keeps the previous page on screen while the next loads, so the layout
    // does not collapse into a spinner on every filter change.
    placeholderData: keepPreviousData,
    retry: false,
  });

  const update = (next) => setSearchParams(toParams(next), { replace: true });

  function reset() {
    setTerm('');
    setSearchParams({}, { replace: true });
  }

  function useMyLocation() {
    if (!navigator.geolocation) {
      toast.error('Your browser cannot share your location');
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        update({
          ...filters,
          lat: position.coords.latitude.toFixed(6),
          lng: position.coords.longitude.toFixed(6),
          sort: 'distance',
          page: 1,
        });
        toast.success('Showing the nearest professionals first');
      },
      () => toast.error('We could not get your location. Try a pincode instead.'),
    );
  }

  const results = data?.data ?? [];
  const meta = data?.meta ?? {};
  const activeFilterCount = [
    filters.category, filters.pincode, filters.minRating, filters.maxPriceMinor,
  ].filter(Boolean).length;

  return (
    <div className="page-field -mt-px">
    <div className="page py-5 sm:py-7">
      {/* The visible design leads with the search box, but the page still needs
          a heading for screen readers and for the document outline. */}
      <h1 className="sr-only">Find a professional</h1>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <label htmlFor="search-input" className="sr-only">Search for a service</label>
          <SearchIcon
            aria-hidden="true"
            className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-ink-400"
          />
          <input
            id="search-input"
            type="search"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="Search plumbers, AC service, wiring"
            className="h-12 w-full rounded-field border border-ink-300 bg-white pl-11 pr-4 text-base
                       shadow-xs transition-[border-color,box-shadow] duration-200 ease-out
                       placeholder:text-ink-400 hover:border-ink-400 hover:shadow-card
                       focus:border-brand-600 focus:shadow-card focus:outline-none focus:ring-4 focus:ring-brand-600/15"
          />
        </div>

        <Button variant="secondary" size="lg" icon={MapPin} onClick={useMyLocation} className="shrink-0">
          Near me
        </Button>

        <Button
          variant="secondary"
          size="lg"
          icon={SlidersHorizontal}
          onClick={() => setFiltersOpen(true)}
          className="shrink-0 lg:hidden"
        >
          Filters
          {activeFilterCount > 0 && (
            <span className="ml-1 rounded-pill bg-brand-gradient px-1.5 text-xs font-semibold text-white">
              {activeFilterCount}
            </span>
          )}
        </Button>
      </div>

      <div className="mt-5 flex gap-6">
        <aside className="hidden w-64 shrink-0 lg:block">
          <div className="filter-panel sticky top-24">
            <h2 className="mb-4 flex items-center gap-2 font-semibold text-ink-900">
              <span className="icon-chip icon-chip-brand h-7 w-7">
                <SlidersHorizontal aria-hidden="true" className="h-4 w-4" />
              </span>
              Filters
            </h2>
            <SearchFilters
              filters={filters}
              categories={categories}
              onChange={update}
              onReset={reset}
              hasLocation={Boolean(filters.lat)}
            />
          </div>
        </aside>

        <div className="min-w-0 flex-1">
          <div className="mb-4 flex items-baseline justify-between gap-3">
            <p className="text-base text-ink-600" aria-live="polite">
              {isLoading
                ? 'Searching'
                : meta.total === 0
                  ? 'No professionals found'
                  : meta.total + (meta.total === 1 ? ' professional' : ' professionals') + ' available'}
            </p>
            {isFetching && !isLoading && <span className="text-sm text-ink-400">Updating</span>}
          </div>

          {error && (
            <Alert variant="error" title="We could not run that search">
              {error.message}
            </Alert>
          )}

          {isLoading ? (
            <SkeletonGrid count={6} className="sm:grid-cols-2 lg:grid-cols-2 xl:grid-cols-3" />
          ) : results.length === 0 && !error ? (
            <EmptyState
              icon={SearchX}
              title="No professionals match these filters"
              description="Try widening your search: remove the pincode, lower the minimum rating, or pick a different service."
              action={<Button onClick={reset}>Clear all filters</Button>}
            />
          ) : (
            <>
              {/* Keyed on the page so the stagger replays when the user pages
                  through results, rather than only on first mount. */}
              <div
                key={meta.page || 1}
                className="results-grid stagger grid gap-4 sm:grid-cols-2 xl:grid-cols-3"
              >
                {results.map((provider) => (
                  <ProviderCard key={provider.id} provider={provider} />
                ))}
              </div>

              <Pagination
                className="mt-6"
                page={meta.page || 1}
                totalPages={meta.totalPages}
                total={meta.total}
                onChange={(page) => {
                  update({ ...filters, page });
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }}
              />
            </>
          )}
        </div>
      </div>

      <Modal open={filtersOpen} onClose={() => setFiltersOpen(false)} title="Filters">
        <SearchFilters
          filters={filters}
          categories={categories}
          onChange={(next) => {
            update(next);
            setFiltersOpen(false);
          }}
          onReset={() => {
            reset();
            setFiltersOpen(false);
          }}
          hasLocation={Boolean(filters.lat)}
        />
      </Modal>
    </div>
    </div>
  );
}
