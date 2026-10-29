import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, ShieldCheck } from 'lucide-react';
import { api } from '../../lib/api.js';
import { useToast } from '../../context/ToastContext.jsx';
import Card, { CardBody, CardHeader } from '../../components/ui/Card.jsx';
import Badge from '../../components/ui/Badge.jsx';
import Button from '../../components/ui/Button.jsx';
import Input from '../../components/ui/Input.jsx';
import Textarea from '../../components/ui/Textarea.jsx';
import { PageLoader } from '../../components/ui/Spinner.jsx';
import useDocumentTitle from '../../hooks/useDocumentTitle.js';
import PageHeader from '../../components/ui/PageHeader.jsx';

const VERIFICATION_VARIANT = {
  unsubmitted: 'neutral',
  pending: 'warning',
  info_requested: 'warning',
  approved: 'success',
  rejected: 'danger',
  suspended: 'danger',
};

export default function AgencyProfile() {
  useDocumentTitle('Agency profile');
  const toast = useToast();
  const queryClient = useQueryClient();

  const [form, setForm] = useState(null);

  const { data, isLoading } = useQuery({
    queryKey: ['agency', 'me'],
    queryFn: async () => (await api.get('/agencies/me')).data,
  });

  // Seeded once from the server, then owned by the form - a refetch must not
  // overwrite what someone is in the middle of typing.
  useEffect(() => {
    if (data && !form) {
      setForm({
        name: data.name ?? '',
        headline: data.headline ?? '',
        about: data.about ?? '',
        registrationNo: data.registrationNo ?? '',
        addressLine: data.address?.line ?? '',
        city: data.address?.city ?? '',
        state: data.address?.state ?? '',
        pincode: data.address?.pincode ?? '',
      });
    }
  }, [data, form]);

  const save = useMutation({
    mutationFn: () =>
      api.patch('/agencies/me', {
        name: form.name.trim(),
        headline: form.headline.trim() || null,
        about: form.about.trim() || null,
        registrationNo: form.registrationNo.trim() || null,
        addressLine: form.addressLine.trim() || null,
        city: form.city.trim() || null,
        state: form.state.trim() || null,
        pincode: form.pincode.trim() || null,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agency'] });
      toast.success('Agency profile updated');
    },
    onError: (e) => toast.error(e.message),
  });

  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));
  const fieldError = (name) => save.error?.fieldErrors?.[name];

  if (isLoading || !form) return <PageLoader label="Loading your agency" />;

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader icon={Building2} title="Agency profile" description="Customers see your agency name next to everyone on your team." />

      <Card className="mt-5">
        <CardHeader
          title={data.name}
          subtitle={data.contactName + ' · ' + data.email}
          action={
            <Badge variant={VERIFICATION_VARIANT[data.verificationStatus]} size="sm">
              {data.verificationStatus === 'approved' && (
                <ShieldCheck aria-hidden="true" className="h-3 w-3" />
              )}
              {data.verificationStatus.replace('_', ' ')}
            </Badge>
          }
        />
        <CardBody>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              save.mutate();
            }}
            className="space-y-4"
          >
            <Input
              label="Agency name"
              icon={Building2}
              value={form.name}
              onChange={set('name')}
              error={fieldError('name')}
              required
              hint="Shown to customers on every one of your team's profiles."
            />

            <Input
              label="What your agency does"
              value={form.headline}
              onChange={set('headline')}
              error={fieldError('headline')}
              placeholder="Electrical and plumbing across Bidar"
              maxLength={140}
            />

            <Textarea
              label="About"
              rows={3}
              maxLength={1500}
              value={form.about}
              onChange={set('about')}
              error={fieldError('about')}
              hint="Optional. How long you have been going, what you specialise in."
            />

            <Input
              label="Business registration number"
              value={form.registrationNo}
              onChange={set('registrationNo')}
              error={fieldError('registrationNo')}
              hint="Optional, but it speeds up verification."
            />

            <div className="rule-soft my-2" />

            <Input
              label="Address"
              value={form.addressLine}
              onChange={set('addressLine')}
              error={fieldError('addressLine')}
            />

            <div className="grid gap-4 sm:grid-cols-3">
              <Input label="City" value={form.city} onChange={set('city')} error={fieldError('city')} />
              <Input label="State" value={form.state} onChange={set('state')} error={fieldError('state')} />
              <Input
                label="Pincode"
                value={form.pincode}
                onChange={set('pincode')}
                error={fieldError('pincode')}
                inputMode="numeric"
              />
            </div>

            <Button type="submit" loading={save.isPending} disabled={form.name.trim().length < 2}>
              Save changes
            </Button>
          </form>
        </CardBody>
      </Card>
    </div>
  );
}
