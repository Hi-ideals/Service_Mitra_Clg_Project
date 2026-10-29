import { useEffect } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api.js';
import { keys } from '../../lib/queryClient.js';
import { useToast } from '../../context/ToastContext.jsx';
import Card, { CardBody, CardHeader } from '../../components/ui/Card.jsx';
import Input from '../../components/ui/Input.jsx';
import Select from '../../components/ui/Select.jsx';
import Button from '../../components/ui/Button.jsx';
import Alert from '../../components/ui/Alert.jsx';
import { PageLoader } from '../../components/ui/Spinner.jsx';
import useDocumentTitle from '../../hooks/useDocumentTitle.js';
import PageHeader from '../../components/ui/PageHeader.jsx';

/**
 * One form per settings key.
 *
 * The API validates each key against its own schema and rejects anything that
 * does not match, so a single combined form would fail as a whole when one
 * field was wrong.
 */
function SettingSection({ title, subtitle, settingKey, defaults, children, onSaved }) {
  const toast = useToast();
  const form = useForm({ defaultValues: defaults });

  useEffect(() => {
    form.reset(defaults);
  }, [JSON.stringify(defaults)]);

  const save = useMutation({
    mutationFn: (values) => api.put('/admin/settings/' + settingKey, values),
    onSuccess: () => {
      onSaved();
      toast.success('Saved. This applies to new bookings from now on.');
    },
    onError: (error) => {
      const fields = error.fieldErrors || {};
      if (Object.keys(fields).length) {
        Object.entries(fields).forEach(([name, message]) => form.setError(name, { message }));
      } else {
        toast.error(error.message);
      }
    },
  });

  return (
    <Card>
      <CardHeader title={title} subtitle={subtitle} />
      <CardBody>
        <form onSubmit={form.handleSubmit((v) => save.mutate(v))} className="space-y-4">
          {children(form)}
          <Button type="submit" loading={save.isPending}>
            Save
          </Button>
        </form>
      </CardBody>
    </Card>
  );
}

export default function Settings() {
  useDocumentTitle('Platform settings');
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: keys.admin.settings,
    queryFn: async () => (await api.get('/admin/settings')).data,
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: keys.admin.settings });

  if (isLoading) return <PageLoader />;
  if (!data) return null;

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader icon={SlidersHorizontal} title="Platform settings" description="Every change here is recorded against your account." />

      <Alert variant="info" className="mt-4">
        Changes apply to new bookings only. A booking already taken keeps the commission rate and
        policy it was created under, so history is never rewritten.
      </Alert>

      <div className="mt-5 space-y-4">
        <SettingSection
          title="Commission"
          subtitle="What the platform keeps from each completed job."
          settingKey="commission"
          defaults={data.commission}
          onSaved={refresh}
        >
          {(form) => (
            <Input
              label="Default commission"
              type="number"
              step="0.5"
              min={0}
              max={50}
              suffix="%"
              required
              hint="A category can override this. Above 50% is rejected."
              error={form.formState.errors.defaultPercent?.message}
              {...form.register('defaultPercent', { required: true, valueAsNumber: true })}
            />
          )}
        </SettingSection>

        <SettingSection
          title="Booking lifecycle"
          subtitle="How long each stage stays open."
          settingKey="booking"
          defaults={data.booking}
          onSaved={refresh}
        >
          {(form) => (
            <div className="grid gap-4 sm:grid-cols-3">
              <Input
                label="Response window"
                type="number"
                min={5}
                max={1440}
                suffix="min"
                required
                hint="Unanswered requests auto-cancel."
                {...form.register('acceptWindowMinutes', { required: true, valueAsNumber: true })}
              />
              <Input
                label="Dispute window"
                type="number"
                min={1}
                max={720}
                suffix="hrs"
                required
                hint="Payouts are held this long."
                {...form.register('disputeWindowHours', { required: true, valueAsNumber: true })}
              />
              <Input
                label="Book ahead limit"
                type="number"
                min={1}
                max={365}
                suffix="days"
                required
                {...form.register('maxAdvanceDays', { required: true, valueAsNumber: true })}
              />
            </div>
          )}
        </SettingSection>

        <SettingSection
          title="Cancellation policy"
          subtitle="What a customer pays for cancelling late."
          settingKey="cancellation"
          defaults={data.cancellation}
          onSaved={refresh}
        >
          {(form) => (
            <div className="grid gap-4 sm:grid-cols-3">
              <Input
                label="Free window"
                type="number"
                min={0}
                max={168}
                suffix="hrs"
                required
                hint="Free before this."
                {...form.register('freeWindowHours', { required: true, valueAsNumber: true })}
              />
              <Input
                label="Late fee"
                type="number"
                min={0}
                max={100}
                suffix="%"
                required
                {...form.register('lateFeePercent', { required: true, valueAsNumber: true })}
              />
              <Input
                label="No-show fee"
                type="number"
                min={0}
                max={100}
                suffix="%"
                required
                {...form.register('noShowFeePercent', { required: true, valueAsNumber: true })}
              />
            </div>
          )}
        </SettingSection>

        <SettingSection
          title="Payouts"
          subtitle="When providers are paid."
          settingKey="payout"
          defaults={data.payout}
          onSaved={refresh}
        >
          {(form) => (
            <div className="grid gap-4 sm:grid-cols-2">
              <Select
                label="Schedule"
                required
                options={[
                  { value: 'daily', label: 'Daily' },
                  { value: 'weekly', label: 'Weekly' },
                  { value: 'fortnightly', label: 'Fortnightly' },
                  { value: 'monthly', label: 'Monthly' },
                ]}
                {...form.register('schedule', { required: true })}
              />
              <Input
                label="Minimum payout"
                type="number"
                min={0}
                suffix="paise"
                required
                hint="Balances below this roll into the next run."
                {...form.register('minimumAmountMinor', { required: true, valueAsNumber: true })}
              />
            </div>
          )}
        </SettingSection>

        <SettingSection
          title="Tax"
          subtitle="How tax appears on invoices."
          settingKey="tax"
          defaults={data.tax}
          onSaved={refresh}
        >
          {(form) => (
            <div className="grid gap-4 sm:grid-cols-2">
              <Input
                label="GST rate"
                type="number"
                step="0.5"
                min={0}
                max={100}
                suffix="%"
                required
                {...form.register('gstPercent', { required: true, valueAsNumber: true })}
              />
              <Select
                label="Tax treatment"
                options={[
                  { value: 'true', label: 'Included in the price' },
                  { value: 'false', label: 'Added on top' },
                ]}
                {...form.register('inclusive', { setValueAs: (v) => v === 'true' || v === true })}
              />
            </div>
          )}
        </SettingSection>
      </div>
    </div>
  );
}
