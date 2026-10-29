import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { Plus, Pencil, Trash2, Layers, ImagePlus } from 'lucide-react';
import { api } from '../../lib/api.js';
import { keys } from '../../lib/queryClient.js';
import { useToast } from '../../context/ToastContext.jsx';
import Card, { CardBody, CardHeader } from '../../components/ui/Card.jsx';
import Button from '../../components/ui/Button.jsx';
import Input from '../../components/ui/Input.jsx';
import Select from '../../components/ui/Select.jsx';
import Modal from '../../components/ui/Modal.jsx';
import Badge from '../../components/ui/Badge.jsx';
import Alert from '../../components/ui/Alert.jsx';
import { PageLoader } from '../../components/ui/Spinner.jsx';
import { money, pluralise } from '../../lib/format.js';
import useDocumentTitle from '../../hooks/useDocumentTitle.js';
import PageHeader from '../../components/ui/PageHeader.jsx';

const UNITS = [
  { value: 'per_visit', label: 'Per visit' },
  { value: 'per_hour', label: 'Per hour' },
];

/** Matches the API: images only, and under the server's upload limit. */
const PHOTO_TYPES = 'image/jpeg,image/png,image/webp';
const PHOTO_MAX_MB = 5;

export default function Categories() {
  useDocumentTitle('Service categories');
  const toast = useToast();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(null);
  const [photo, setPhoto] = useState(null);
  const [photoPreview, setPhotoPreview] = useState(null);

  // The preview is an object URL, which holds the file in memory until revoked.
  useEffect(() => {
    if (!photo) {
      setPhotoPreview(null);
      return undefined;
    }
    const url = URL.createObjectURL(photo);
    setPhotoPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);

  const { data: tree, isLoading } = useQuery({
    queryKey: [...keys.categories.tree, 'admin'],
    queryFn: async () => (await api.get('/categories/tree', { params: { includeInactive: true } })).data,
  });

  const form = useForm();

  useEffect(() => {
    setPhoto(null);
    if (!editing) return;
    form.reset(
      editing.id
        ? {
            name: editing.name,
            basePrice: editing.pricing.base,
            minPrice: editing.pricing.min,
            maxPrice: editing.pricing.max ?? '',
            pricingUnit: editing.pricing.unit,
            estimatedMinutes: editing.estimatedMinutes,
            parentId: editing.parentId || '',
            requiresCertification: Boolean(editing.requiresCertification),
          }
        : {
            pricingUnit: 'per_visit',
            estimatedMinutes: 60,
            parentId: editing.parentId || '',
            requiresCertification: false,
          },
    );
  }, [editing]);

  const refresh = () => queryClient.invalidateQueries({ queryKey: keys.categories.all });

  const save = useMutation({
    mutationFn: async (values) => {
      const parentMode = editing?.id ? !editing.parentId : editing?.kind === 'parent';

      // A parent is a heading customers browse by, so it is created without a
      // price band of its own: zero, with no maximum, which the home page
      // shows as no price at all. An edit sends the name alone, so an older
      // parent keeps whatever band it already had.
      const payload = parentMode
        ? editing?.id
          ? { name: values.name }
          : { name: values.name, parentId: null, basePriceMinor: 0, minPriceMinor: 0 }
        : {
            name: values.name,
            parentId: values.parentId || null,
            basePriceMinor: Math.round(Number(values.basePrice) * 100),
            minPriceMinor: Math.round(Number(values.minPrice) * 100),
            maxPriceMinor: values.maxPrice ? Math.round(Number(values.maxPrice) * 100) : null,
            pricingUnit: values.pricingUnit,
            estimatedMinutes: Number(values.estimatedMinutes),
            requiresCertification: Boolean(values.requiresCertification),
          };
      const { data: saved } = editing?.id
        ? await api.patch('/categories/' + editing.id, payload)
        : await api.post('/categories', payload);

      // Uploaded after the save, because a new category has no id until then.
      // Only a top-level category carries a photo.
      if (photo && !saved.parentId) {
        const body = new FormData();
        body.append('file', photo);
        try {
          await api.upload('/categories/' + saved.id + '/image', body);
        } catch (error) {
          // The category itself did save, so say that rather than failing the
          // whole form and inviting a second, duplicate create.
          refresh();
          setEditing(null);
          throw new Error('Category saved, but the photo did not upload: ' + error.message);
        }
      }
      return saved;
    },
    onSuccess: () => {
      refresh();
      setEditing(null);
      toast.success('Category saved');
    },
    onError: (error) => toast.error(error.message),
  });

  const remove = useMutation({
    mutationFn: (id) => api.delete('/categories/' + id),
    onSuccess: ({ data }) => {
      refresh();
      // The API deactivates rather than deletes when a category has history,
      // and says why. Passing that through is more honest than "Deleted".
      toast.success(data.deleted ? 'Category removed' : data.reason);
    },
    onError: (error) => toast.error(error.message),
  });

  if (isLoading) return <PageLoader />;

  const rows = (tree || []).flatMap((parent) => [
    { ...parent, depth: 0 },
    ...(parent.children || []).map((child) => ({ ...child, depth: 1 })),
  ]);

  const parentOptions = (tree || [])
    .filter((p) => p.id !== editing?.id)
    .map((p) => ({ value: p.id, label: p.name }));

  // Which of the two buttons opened the form - or, for an existing category,
  // which level it already sits at. The API does not move a category between
  // levels, so this never changes once it is created.
  const isTopLevel = editing?.id ? !editing.parentId : editing?.kind === 'parent';
  const currentPhoto = photoPreview || (editing?.id && editing.imageUrl) || null;

  function pickPhoto(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!PHOTO_TYPES.split(',').includes(file.type)) {
      toast.error('Choose a JPG, PNG or WEBP photo');
      return;
    }
    if (file.size > PHOTO_MAX_MB * 1024 * 1024) {
      toast.error('That photo is larger than ' + PHOTO_MAX_MB + ' MB');
      return;
    }
    setPhoto(file);
  }

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        icon={Layers}
        title="Service categories"
        description="The price band here is a rule: providers cannot price outside it."
        action={
          <div className="flex flex-wrap gap-2">
            <Button icon={Plus} onClick={() => setEditing({ kind: 'parent', parentId: '' })}>
              Add parent category
            </Button>
            {/* A subcategory needs a parent to sit under, so this waits for one. */}
            <Button
              variant="secondary"
              icon={Plus}
              disabled={parentOptions.length === 0}
              onClick={() => setEditing({ kind: 'child', parentId: '' })}
            >
              Add subcategory
            </Button>
          </div>
        }
      />

      <Card className="mt-5">
        <CardHeader title={pluralise(rows.length, 'category', 'categories')} />
        <CardBody className="p-0">
          <ul className="divide-y divide-ink-200">
            {rows.map((row) => (
              <li
                key={row.id}
                className={clsx(
                  'flex items-center justify-between gap-3 px-4 py-3 sm:px-5',
                  row.depth === 1 && 'bg-ink-50/50',
                )}
              >
                <div className={clsx('flex min-w-0 items-center gap-3', row.depth === 1 && 'pl-5')}>
                  {row.depth === 0 && (
                    <div className="h-11 w-11 shrink-0 overflow-hidden rounded-field bg-ink-100 ring-1 ring-inset ring-ink-200">
                      {row.imageUrl ? (
                        <img src={row.imageUrl} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <ImagePlus aria-hidden="true" className="m-auto mt-3 h-5 w-5 text-ink-400" />
                      )}
                    </div>
                  )}
                  <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium text-ink-900">{row.name}</p>
                    {!row.isActive && <Badge variant="neutral" size="sm">Inactive</Badge>}
                    {row.requiresCertification && (
                      <Badge variant="warning" size="sm">Licence needed</Badge>
                    )}
                  </div>
                  {/* A parent has no price of its own, so its line says what it holds. */}
                  <p className="mt-0.5 text-sm text-ink-500">
                    {row.depth === 0
                      ? pluralise(row.children?.length ?? 0, 'subcategory', 'subcategories')
                      : money(row.pricing.min) +
                        (row.pricing.max ? ' to ' + money(row.pricing.max) : ' and up') +
                        ' · ' + row.estimatedMinutes + ' min'}
                    {row.providerCount > 0 && ' · ' + pluralise(row.providerCount, 'provider')}
                  </p>
                  </div>
                </div>

                <div className="flex shrink-0 gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={'Edit ' + row.name}
                    onClick={() => setEditing(row)}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={'Remove ' + row.name}
                    onClick={() => remove.mutate(row.id)}
                    className="text-danger-600 hover:bg-danger-50"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>

      <Modal
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        title={
          (editing?.id ? 'Edit ' : 'Add a ') + (isTopLevel ? 'parent category' : 'subcategory')
        }
      >
        <form onSubmit={form.handleSubmit((v) => save.mutate(v))} className="space-y-4">
          {!isTopLevel && (
            <Alert variant="info">
              Providers set their own price, but it must fall inside the minimum and maximum you set
              here.
            </Alert>
          )}

          <Input
            label="Name"
            required
            placeholder={isTopLevel ? 'Plumbing' : 'Tap and mixer repair'}
            error={form.formState.errors.name?.message}
            {...form.register('name', { required: 'Enter a name' })}
          />

          {!isTopLevel && (
            <Select
              label="Parent category"
              placeholder="Choose the parent category"
              options={parentOptions}
              required={!editing?.id}
              disabled={Boolean(editing?.id)}
              error={form.formState.errors.parentId?.message}
              hint={
                editing?.id
                  ? 'A subcategory stays under the parent it was created in.'
                  : 'The parent this subcategory is listed under.'
              }
              {...form.register('parentId', {
                validate: (v) => Boolean(editing?.id) || Boolean(v) || 'Choose a parent category',
              })}
            />
          )}

          {isTopLevel && (
            <div>
              <p className="text-base font-medium text-ink-900">Photo</p>
              <p className="mt-0.5 text-sm text-ink-500">
                Shown on this category&apos;s tile on the home page. JPG, PNG or WEBP, up to{' '}
                {PHOTO_MAX_MB} MB.
              </p>
              <div className="mt-2 flex items-center gap-3">
                <div className="h-16 w-24 shrink-0 overflow-hidden rounded-field bg-ink-100 ring-1 ring-inset ring-ink-200">
                  {currentPhoto ? (
                    <img src={currentPhoto} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <ImagePlus aria-hidden="true" className="m-auto mt-5 h-6 w-6 text-ink-400" />
                  )}
                </div>
                <label className="cursor-pointer">
                  <input type="file" accept={PHOTO_TYPES} className="sr-only" onChange={pickPhoto} />
                  <span className="inline-flex h-8 items-center gap-1.5 rounded-field bg-white px-3 text-sm font-medium text-ink-800 shadow-xs ring-1 ring-inset ring-ink-300 hover:bg-ink-50">
                    <ImagePlus aria-hidden="true" className="h-4 w-4" />
                    {currentPhoto ? 'Change photo' : 'Choose photo'}
                  </span>
                </label>
                {photo && (
                  <Button type="button" variant="ghost" size="sm" onClick={() => setPhoto(null)}>
                    Undo
                  </Button>
                )}
              </div>
            </div>
          )}

          {/* Pricing, duration and the licence flag describe a service someone
              books, which a parent heading is not. */}
          {!isTopLevel && (
          <>
          <div className="grid gap-4 sm:grid-cols-3">
            <Input
              label="Minimum"
              type="number"
              min={0}
              suffix="Rs"
              required
              {...form.register('minPrice', { required: true })}
            />
            <Input
              label="Suggested"
              type="number"
              min={0}
              suffix="Rs"
              required
              {...form.register('basePrice', { required: true })}
            />
            <Input label="Maximum" type="number" min={0} suffix="Rs" {...form.register('maxPrice')} />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Select label="Pricing unit" options={UNITS} {...form.register('pricingUnit')} />
            <Input
              label="Typical duration"
              type="number"
              min={5}
              max={1440}
              suffix="min"
              required
              {...form.register('estimatedMinutes', { required: true })}
            />
          </div>

          {/* Advisory, not a gate: it flags a provider's KYC for a closer look
              when they offer this trade. Said plainly here so an admin knows
              what ticking it does and does not do. */}
          <label className="flex cursor-pointer items-start gap-3 panel-tint rounded-field p-3 ring-1 ring-inset ring-ink-200">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 shrink-0 accent-brand-600"
              {...form.register('requiresCertification')}
            />
            <span className="min-w-0">
              <span className="block text-base font-medium text-ink-900">
                Needs a trade licence
              </span>
              <span className="mt-0.5 block text-sm text-ink-500">
                Flags the verification queue to check this provider&apos;s certificate before
                approving them. It does not stop anyone offering the service.
              </span>
            </span>
          </label>
          </>
          )}

          <div className="flex gap-2">
            <Button type="button" variant="secondary" onClick={() => setEditing(null)} className="flex-1">
              Cancel
            </Button>
            <Button type="submit" loading={save.isPending} className="flex-1">
              Save category
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
