import { SlidersHorizontal, X } from 'lucide-react';
import Button from '../../components/ui/Button.jsx';
import Select from '../../components/ui/Select.jsx';
import Input from '../../components/ui/Input.jsx';

const SORTS = [
  { value: 'relevance', label: 'Best match' },
  { value: 'rating', label: 'Highest rated' },
  { value: 'price_low', label: 'Price: low to high' },
  { value: 'price_high', label: 'Price: high to low' },
  { value: 'experience', label: 'Most experienced' },
  { value: 'distance', label: 'Nearest first' },
];

/**
 * The filter panel.
 *
 * Shared between the desktop sidebar and the mobile sheet, so the two cannot
 * drift apart and offer different filters.
 */
export default function SearchFilters({ filters, categories, onChange, onReset, hasLocation }) {
  const set = (patch) => onChange({ ...filters, ...patch, page: 1 });

  const categoryOptions = (categories || []).flatMap((parent) => [
    { value: parent.slug, label: parent.name },
    ...(parent.children || []).map((child) => ({ value: child.slug, label: '   ' + child.name })),
  ]);

  return (
    <div className="space-y-5">
      <Select
        label="Service"
        value={filters.category || ''}
        onChange={(e) => set({ category: e.target.value || undefined })}
        placeholder="All services"
        options={categoryOptions}
      />

      <Input
        label="Pincode"
        inputMode="numeric"
        maxLength={6}
        placeholder="585401"
        value={filters.pincode || ''}
        onChange={(e) => set({ pincode: e.target.value.replace(/\D/g, '') || undefined })}
        hint="Only shows professionals who cover your area."
      />

      <fieldset>
        <legend className="mb-1.5 text-sm font-medium text-ink-700">Minimum rating</legend>
        <div className="flex flex-wrap gap-1.5">
          {[0, 3, 4, 4.5].map((rating) => (
            <button
              key={rating}
              type="button"
              onClick={() => set({ minRating: rating || undefined })}
              className={
                'flex items-center gap-1 rounded-pill px-3 py-1.5 text-sm font-medium ' +
                'transition-[background-color,box-shadow,color] duration-200 ' +
                ((filters.minRating || 0) === rating
                  ? 'bg-brand-gradient text-white shadow-glow-brand'
                  : 'bg-white text-ink-600 shadow-xs ring-1 ring-inset ring-ink-200 hover:bg-ink-50 hover:ring-ink-300')
              }
            >
              {rating === 0 ? 'Any' : rating + '+'}
            </button>
          ))}
        </div>
      </fieldset>

      <div>
        <p className="mb-1.5 text-sm font-medium text-ink-700">Maximum price</p>
        <div className="flex flex-wrap gap-1.5">
          {[
            { label: 'Any', value: undefined },
            { label: 'Under ₹300', value: 30000 },
            { label: 'Under ₹600', value: 60000 },
            { label: 'Under ₹1,500', value: 150000 },
          ].map((band) => (
            <button
              key={band.label}
              type="button"
              onClick={() => set({ maxPriceMinor: band.value })}
              className={
                'rounded-pill px-3 py-1.5 text-sm font-medium ' +
                'transition-[background-color,box-shadow,color] duration-200 ' +
                (filters.maxPriceMinor === band.value
                  ? 'bg-brand-gradient text-white shadow-glow-brand'
                  : 'bg-white text-ink-600 shadow-xs ring-1 ring-inset ring-ink-200 hover:bg-ink-50 hover:ring-ink-300')
              }
            >
              {band.label}
            </button>
          ))}
        </div>
      </div>

      <Select
        label="Sort by"
        value={filters.sort || 'relevance'}
        onChange={(e) => set({ sort: e.target.value })}
        // Sorting by distance needs coordinates; the API rejects it otherwise,
        // so the option is disabled rather than offered and then refused.
        options={SORTS.map((s) => ({
          ...s,
          label: s.value === 'distance' && !hasLocation ? s.label + ' (needs your location)' : s.label,
        }))}
      />

      <Button variant="ghost" size="sm" icon={X} onClick={onReset} fullWidth>
        Clear all filters
      </Button>
    </div>
  );
}

export { SlidersHorizontal };
