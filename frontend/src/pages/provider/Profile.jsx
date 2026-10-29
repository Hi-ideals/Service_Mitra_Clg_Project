import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, MapPin, UserCog } from 'lucide-react';
import { api } from '../../lib/api.js';
import { keys } from '../../lib/queryClient.js';
import { useToast } from '../../context/ToastContext.jsx';
import Card, { CardBody, CardHeader } from '../../components/ui/Card.jsx';
import Input from '../../components/ui/Input.jsx';
import Textarea from '../../components/ui/Textarea.jsx';
import Select from '../../components/ui/Select.jsx';
import Button from '../../components/ui/Button.jsx';
import Modal from '../../components/ui/Modal.jsx';
import Alert from '../../components/ui/Alert.jsx';
import { PageLoader } from '../../components/ui/Spinner.jsx';
import { money } from '../../lib/format.js';
import useDocumentTitle from '../../hooks/useDocumentTitle.js';
import PageHeader from '../../components/ui/PageHeader.jsx';

export default function Profile() {
  useDocumentTitle('My profile');
  const toast = useToast();
  const queryClient = useQueryClient();
  const [serviceOpen, setServiceOpen] = useState(false);
  const [areaOpen, setAreaOpen] = useState(false);

  const { data: profile, isLoading } = useQuery({
    queryKey: keys.providers.me,
    queryFn: async () => (await api.get('/providers/me')).data,
  });

  const { data: categories } = useQuery({
    queryKey: keys.categories.tree,
    queryFn: async () => (await api.get('/categories/tree')).data,
    staleTime: 10 * 60_000,
  });

  const profileForm = useForm();
  const serviceForm = useForm();
  const areaForm = useForm({ defaultValues: { city: 'Bidar', state: 'Karnataka', radiusKm: 10 } });

  useEffect(() => {
    if (!profile) return;
    profileForm.reset({
      businessName: profile.businessName || '',
      headline: profile.headline || '',
      bio: profile.bio || '',
      experienceYears: profile.experienceYears || 0,
      skills: (profile.skills || []).join(', '),
      languages: (profile.languages || []).join(', '),
    });
  }, [profile]);

  const refresh = () => queryClient.invalidateQueries({ queryKey: keys.providers.me });

  const saveProfile = useMutation({
    mutationFn: (values) =>
      api.patch('/providers/me', {
        businessName: values.businessName || null,
        headline: values.headline || null,
        bio: values.bio || null,
        experienceYears: Number(values.experienceYears) || 0,
        // The API takes arrays; the form is a comma-separated field because
        // that is far quicker to type on a phone than a tag editor.
        skills: values.skills ? values.skills.split(',').map((s) => s.trim()).filter(Boolean) : [],
        languages: values.languages ? values.languages.split(',').map((s) => s.trim()).filter(Boolean) : [],
      }),
    onSuccess: () => {
      refresh();
      toast.success('Profile saved');
    },
    onError: (e) => toast.error(e.message),
  });

  const saveService = useMutation({
    mutationFn: (values) =>
      api.put('/providers/me/services', {
        categoryId: values.categoryId,
        priceMinor: Math.round(Number(values.price) * 100),
      }),
    onSuccess: () => {
      refresh();
      setServiceOpen(false);
      serviceForm.reset();
      toast.success('Service saved');
    },
    // The API refuses a price outside the admin band with the actual figure in
    // the message, which is more useful than a generic validation error.
    onError: (e) => toast.error(e.message),
  });

  const removeService = useMutation({
    mutationFn: (categoryId) => api.delete('/providers/me/services/' + categoryId),
    onSuccess: () => {
      refresh();
      toast.success('Service removed');
    },
    onError: (e) => toast.error(e.message),
  });

  const saveArea = useMutation({
    mutationFn: (values) =>
      api.post('/providers/me/areas', {
        city: values.city,
        state: values.state,
        pincodes: values.pincodes ? values.pincodes.split(',').map((p) => p.trim()).filter(Boolean) : [],
        radiusKm: Number(values.radiusKm),
      }),
    onSuccess: () => {
      refresh();
      setAreaOpen(false);
      areaForm.reset({ city: 'Bidar', state: 'Karnataka', radiusKm: 10 });
      toast.success('Service area added');
    },
    onError: (e) => toast.error(e.message),
  });

  const removeArea = useMutation({
    mutationFn: (areaId) => api.delete('/providers/me/areas/' + areaId),
    onSuccess: () => {
      refresh();
      toast.success('Service area removed');
    },
    onError: (e) => toast.error(e.message),
  });

  if (isLoading) return <PageLoader />;
  if (!profile) return null;

  const allCategories = (categories || []).flatMap((parent) => [
    { value: parent.id, label: parent.name, pricing: parent.pricing },
    ...(parent.children || []).map((child) => ({
      value: child.id,
      label: '   ' + child.name,
      pricing: child.pricing,
    })),
  ]);

  const selectedCategory = allCategories.find((c) => c.value === serviceForm.watch('categoryId'));

  return (
    <div className="page max-w-3xl py-5 sm:py-7">
      <PageHeader icon={UserCog} title="My profile" />
      <p className="mt-1 text-base text-ink-500">
        This is what customers see when they find you in search.
      </p>

      <div className="mt-5 space-y-4">
        <Card>
          <CardHeader title="About you" />
          <CardBody>
            <form onSubmit={profileForm.handleSubmit((v) => saveProfile.mutate(v))} className="space-y-4">
              <Input
                label="Business name"
                placeholder="Patil Plumbing Works"
                hint="Leave blank to use your own name."
                {...profileForm.register('businessName')}
              />

              <Input
                label="Headline"
                placeholder="Emergency plumbing, 24x7 in Bidar"
                maxLength={160}
                hint="One line. This is the first thing a customer reads."
                {...profileForm.register('headline')}
              />

              <Textarea
                label="About your work"
                rows={4}
                maxLength={2000}
                placeholder="What you do, what you specialise in, how long you have been doing it."
                value={profileForm.watch('bio') || ''}
                {...profileForm.register('bio')}
              />

              <div className="grid gap-4 sm:grid-cols-2">
                <Input
                  label="Years of experience"
                  type="number"
                  min={0}
                  max={70}
                  {...profileForm.register('experienceYears')}
                />
                <Input
                  label="Languages"
                  placeholder="Kannada, Hindi, English"
                  hint="Comma separated."
                  {...profileForm.register('languages')}
                />
              </div>

              <Input
                label="Skills"
                placeholder="Leak repair, Tap fitting, Drainage"
                hint="Comma separated. These help customers find you in search."
                {...profileForm.register('skills')}
              />

              <Button type="submit" loading={saveProfile.isPending}>
                Save profile
              </Button>
            </form>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Services and prices"
            subtitle="Your price must sit inside the platform band for each service."
            action={
              <Button size="sm" icon={Plus} onClick={() => setServiceOpen(true)}>
                Add
              </Button>
            }
          />
          <CardBody className="p-0">
            {profile.services.length === 0 ? (
              <p className="px-4 py-6 text-center text-base text-ink-500 sm:px-5">
                Add at least one service before you can go online.
              </p>
            ) : (
              <ul className="divide-y divide-ink-200">
                {profile.services.map((service) => (
                  <li key={service.id} className="row-hover flex items-center justify-between gap-3 px-4 py-3 sm:px-5">
                    <div className="min-w-0">
                      <p className="font-medium text-ink-900">{service.categoryName}</p>
                      <p className="mt-0.5 text-sm text-ink-500">
                        Platform band {money(service.guideline.min)}
                        {service.guideline.max ? ' to ' + money(service.guideline.max) : ' and up'}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className="font-semibold text-ink-900">{money(service.price)}</span>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={'Remove ' + service.categoryName}
                        onClick={() => removeService.mutate(service.categoryId)}
                        className="text-danger-600 hover:bg-danger-50"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Where you work"
            subtitle="Customers outside these areas will not see you."
            action={
              <Button size="sm" icon={Plus} onClick={() => setAreaOpen(true)}>
                Add
              </Button>
            }
          />
          <CardBody className="p-0">
            {profile.serviceAreas.length === 0 ? (
              <p className="px-4 py-6 text-center text-base text-ink-500 sm:px-5">
                Add at least one service area before you can go online.
              </p>
            ) : (
              <ul className="divide-y divide-ink-200">
                {profile.serviceAreas.map((area) => (
                  <li key={area.id} className="row-hover flex items-center justify-between gap-3 px-4 py-3 sm:px-5">
                    <div className="flex min-w-0 gap-2">
                      <MapPin aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-ink-400" />
                      <div className="min-w-0">
                        <p className="font-medium text-ink-900">{area.city}, {area.state}</p>
                        <p className="mt-0.5 text-sm text-ink-500">
                          Within {area.radiusKm} km
                          {area.pincodes.length > 0 && ' · ' + area.pincodes.join(', ')}
                        </p>
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={'Remove ' + area.city}
                      onClick={() => removeArea.mutate(area.id)}
                      className="shrink-0 text-danger-600 hover:bg-danger-50"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>

      <Modal
        open={serviceOpen}
        onClose={() => setServiceOpen(false)}
        title="Add a service"
        description="Set your own price inside the platform band."
      >
        <form onSubmit={serviceForm.handleSubmit((v) => saveService.mutate(v))} className="space-y-4">
          <Select
            label="Service"
            required
            placeholder="Choose a service"
            options={allCategories}
            {...serviceForm.register('categoryId', { required: 'Choose a service' })}
          />

          {selectedCategory?.pricing && (
            <Alert variant="info">
              Allowed range for {selectedCategory.label.trim()}: {money(selectedCategory.pricing.min)}
              {selectedCategory.pricing.max ? ' to ' + money(selectedCategory.pricing.max) : ' and up'}.
            </Alert>
          )}

          <Input
            label="Your price"
            type="number"
            inputMode="decimal"
            min={0}
            suffix="rupees"
            required
            {...serviceForm.register('price', { required: 'Enter your price' })}
          />


          <div className="flex gap-2">
            <Button type="button" variant="secondary" onClick={() => setServiceOpen(false)} className="flex-1">
              Cancel
            </Button>
            <Button type="submit" loading={saveService.isPending} className="flex-1">
              Save service
            </Button>
          </div>
        </form>
      </Modal>

      <Modal open={areaOpen} onClose={() => setAreaOpen(false)} title="Add a service area">
        <form onSubmit={areaForm.handleSubmit((v) => saveArea.mutate(v))} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="City" required {...areaForm.register('city', { required: 'Enter a city' })} />
            <Input label="State" required {...areaForm.register('state', { required: 'Enter a state' })} />
          </div>

          <Input
            label="Pincodes you cover"
            placeholder="585401, 585402"
            hint="Comma separated. An exact pincode match is the strongest signal in search."
            {...areaForm.register('pincodes')}
          />

          <Input
            label="Travel radius"
            type="number"
            min={1}
            max={200}
            suffix="km"
            required
            {...areaForm.register('radiusKm', { required: 'Enter a radius' })}
          />

          <div className="flex gap-2">
            <Button type="button" variant="secondary" onClick={() => setAreaOpen(false)} className="flex-1">
              Cancel
            </Button>
            <Button type="submit" loading={saveArea.isPending} className="flex-1">
              Add area
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
