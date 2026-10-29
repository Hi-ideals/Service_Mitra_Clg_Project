import { useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { Upload, FileText, CheckCircle2, Clock, XCircle, AlertTriangle, ShieldCheck } from 'lucide-react';
import { api } from '../../lib/api.js';
import { keys } from '../../lib/queryClient.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import Card, { CardBody, CardHeader } from '../../components/ui/Card.jsx';
import Input from '../../components/ui/Input.jsx';
import Select from '../../components/ui/Select.jsx';
import Button from '../../components/ui/Button.jsx';
import Alert from '../../components/ui/Alert.jsx';
import Badge from '../../components/ui/Badge.jsx';
import { PageLoader } from '../../components/ui/Spinner.jsx';
import { formatDateTime } from '../../lib/format.js';
import useDocumentTitle from '../../hooks/useDocumentTitle.js';
import PageHeader from '../../components/ui/PageHeader.jsx';

const ID_TYPES = [
  { value: 'aadhaar', label: 'Aadhaar' },
  { value: 'pan', label: 'PAN' },
  { value: 'voter_id', label: 'Voter ID' },
  { value: 'passport', label: 'Passport' },
  { value: 'driving_licence', label: 'Driving licence' },
];

/**
 * `required` here only drives the labelling. The server decides what a
 * submission must carry; this list repeating it is a convenience for the
 * provider, not the rule - so the two have to be kept in step, and the server
 * refuses an approval either way.
 */
const docTypes = (isAgency) => [
  { value: 'identity', label: 'Identity proof (Aadhaar)', required: true },
  { value: 'address', label: 'Address proof', required: false },
  {
    value: 'photo',
    // The same screen serves an agency, where "your photograph" would be a
    // question about a company.
    label: isAgency ? "The owner's photograph" : 'Your photograph',
    required: true,
  },
  { value: 'trade_certificate', label: 'Trade certificate or licence', required: false },
];

const STATUS = {
  unsubmitted: { icon: AlertTriangle, variant: 'warning', text: 'Not submitted yet' },
  pending: { icon: Clock, variant: 'info', text: 'Under review' },
  info_requested: { icon: AlertTriangle, variant: 'warning', text: 'More information needed' },
  approved: { icon: CheckCircle2, variant: 'success', text: 'Verified' },
  rejected: { icon: XCircle, variant: 'danger', text: 'Not approved' },
  suspended: { icon: XCircle, variant: 'danger', text: 'Suspended' },
};

function DocumentUpload({ docType, label, required, existing, onUploaded, basePath }) {
  const inputRef = useRef(null);
  const toast = useToast();
  const [uploading, setUploading] = useState(false);

  async function upload(file) {
    if (!file) return;

    // Checked here as well as server-side, so the user is told instantly
    // rather than after a slow upload of a file that was never going to work.
    if (file.size > 5 * 1024 * 1024) {
      toast.error('That file is larger than 5 MB');
      return;
    }

    const form = new FormData();
    form.append('docType', docType);
    form.append('file', file);

    setUploading(true);
    try {
      await api.upload(basePath + '/me/documents', form);
      toast.success(label + ' uploaded');
      onUploaded();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  return (
    <div
      className={clsx(
        'rounded-card border p-3',
        existing ? 'border-success-500/30 bg-success-50' : 'border-dashed border-ink-300',
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 gap-2.5">
          <FileText
            aria-hidden="true"
            className={clsx('mt-0.5 h-5 w-5 shrink-0', existing ? 'text-success-600' : 'text-ink-400')}
          />
          <div className="min-w-0">
            <p className="font-medium text-ink-900">
              {label}
              {required && <span className="ml-1 text-danger-600" aria-hidden="true">*</span>}
            </p>
            <p className="mt-0.5 truncate text-sm text-ink-500">
              {existing ? existing.originalName : 'JPG, PNG or PDF, up to 5 MB'}
            </p>
          </div>
        </div>

        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,application/pdf"
          className="sr-only"
          id={'upload-' + docType}
          onChange={(e) => upload(e.target.files?.[0])}
        />

        <Button
          as="label"
          htmlFor={'upload-' + docType}
          variant={existing ? 'ghost' : 'secondary'}
          size="sm"
          icon={Upload}
          loading={uploading}
          className="shrink-0 cursor-pointer"
        >
          {existing ? 'Replace' : 'Upload'}
        </Button>
      </div>
    </div>
  );
}

/**
 * The verification screen.
 *
 * Shared by providers and agencies. The flow is identical - same documents,
 * same review queue - so the only differences are the endpoint it talks to
 * and whether the copy says "you" or "your agency".
 */
export default function Verification({ basePath = '/kyc', subject = 'provider' }) {
  useDocumentTitle(subject === 'agency' ? 'Agency verification' : 'Verification');
  const isAgency = subject === 'agency';
  const toast = useToast();
  const queryClient = useQueryClient();
  const { reloadUser } = useAuth();

  const { data, isLoading } = useQuery({
    queryKey: [...keys.kyc.me, basePath],
    queryFn: async () => (await api.get(basePath + '/me')).data,
  });

  const form = useForm({
    defaultValues: {
      fullLegalName: '', dateOfBirth: '', idProofType: 'aadhaar', idProofLast4: '',
      addressLine: '', city: 'Bidar', state: 'Karnataka', pincode: '',
    },
  });

  const submit = useMutation({
    mutationFn: (values) => api.post(basePath + '/me', values),
    onSuccess: async () => {
      queryClient.invalidateQueries({ queryKey: [...keys.kyc.me, basePath] });
      await reloadUser();
      toast.success('Submitted. Upload your documents next.');
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

  const refreshDocuments = () => queryClient.invalidateQueries({ queryKey: [...keys.kyc.me, basePath] });

  if (isLoading) return <PageLoader />;
  if (!data) return null;

  const state = STATUS[data.status] || STATUS.unsubmitted;
  const StateIcon = state.icon;
  const submission = data.submission;
  const documents = submission?.documents ?? [];
  const missing = data.missingDocuments ?? [];
  const canEdit = data.canSubmit || data.status === 'unsubmitted';

  return (
    <div className="page max-w-3xl py-5 sm:py-7">
      <PageHeader
        icon={ShieldCheck}
        title={isAgency ? 'Agency verification' : 'Verification'}
        description={
          isAgency
            ? 'Verify the agency once and everyone on your team goes live with it. You are vouching for the people you send into customers’ homes.'
            : 'Customers let you into their homes. This is how we confirm who you are.'
        }
      />

      <Card className="mt-5">
        <CardBody className="flex items-start gap-3">
          <StateIcon aria-hidden="true" className="mt-0.5 h-6 w-6 shrink-0 text-ink-400" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-semibold text-ink-900">{state.text}</p>
              <Badge variant={state.variant} size="sm">
                {data.status.replace('_', ' ')}
              </Badge>
            </div>

            {submission?.reviewNotes && (
              <p className="mt-1.5 text-base text-ink-600">{submission.reviewNotes}</p>
            )}
            {submission?.rejectionReason && (
              <p className="mt-1.5 text-base text-danger-700">{submission.rejectionReason}</p>
            )}
            {submission?.submittedAt && (
              <p className="mt-1 text-sm text-ink-400">
                Submitted {formatDateTime(submission.submittedAt)}
              </p>
            )}
          </div>
        </CardBody>
      </Card>

      {data.status === 'approved' ? (
        <Alert variant="success" title="You are verified" className="mt-4">
          You can go online and start accepting bookings. Contact support if your details change.
        </Alert>
      ) : (
        <>
          <Card className="mt-4">
            <CardHeader title="Your details" subtitle="Enter these exactly as they appear on your ID." />
            <CardBody>
              <form onSubmit={form.handleSubmit((v) => submit.mutate(v))} className="space-y-4">
                <Input
                  label="Full legal name"
                  required
                  disabled={!canEdit}
                  error={form.formState.errors.fullLegalName?.message}
                  {...form.register('fullLegalName', { required: 'Enter your full legal name' })}
                />

                <div className="grid gap-4 sm:grid-cols-2">
                  <Input
                    label="Date of birth"
                    type="date"
                    disabled={!canEdit}
                    error={form.formState.errors.dateOfBirth?.message}
                    {...form.register('dateOfBirth')}
                  />
                  <Select
                    label="ID type"
                    required
                    disabled={!canEdit}
                    options={ID_TYPES}
                    {...form.register('idProofType')}
                  />
                </div>

                <Input
                  label="Last 4 digits of your ID number"
                  inputMode="numeric"
                  maxLength={4}
                  required
                  disabled={!canEdit}
                  hint="We never store the full number. It stays in the document, which is private."
                  error={form.formState.errors.idProofLast4?.message}
                  {...form.register('idProofLast4', {
                    required: 'Enter the last 4 digits',
                    pattern: { value: /^[0-9]{4}$/, message: 'Exactly 4 digits' },
                  })}
                />

                <Input
                  label="Address"
                  required
                  disabled={!canEdit}
                  error={form.formState.errors.addressLine?.message}
                  {...form.register('addressLine', { required: 'Enter your address' })}
                />

                <div className="grid gap-4 sm:grid-cols-3">
                  <Input label="City" required disabled={!canEdit} {...form.register('city', { required: true })} />
                  <Input label="State" required disabled={!canEdit} {...form.register('state', { required: true })} />
                  <Input
                    label="Pincode"
                    inputMode="numeric"
                    maxLength={6}
                    required
                    disabled={!canEdit}
                    error={form.formState.errors.pincode?.message}
                    {...form.register('pincode', {
                      required: 'Enter your pincode',
                      pattern: { value: /^[0-9]{6}$/, message: 'Enter a valid 6-digit pincode' },
                    })}
                  />
                </div>

                {canEdit && (
                  <Button type="submit" loading={submit.isPending}>
                    {submission ? 'Update and re-submit' : 'Submit for review'}
                  </Button>
                )}
              </form>
            </CardBody>
          </Card>

          <Card className="mt-4">
            <CardHeader
              title="Documents"
              subtitle={
                submission
                  ? 'Stored privately. Only the reviewing admin can open them.'
                  : 'Submit your details above first.'
              }
            />
            <CardBody className="space-y-3">
              {missing.length > 0 && submission && (
                <Alert variant="warning">
                  Still needed: {missing.join(' and ')} proof. Your account cannot be approved
                  without them.
                </Alert>
              )}

              {docTypes(isAgency).map((doc) => (
                <DocumentUpload
                  key={doc.value}
                  docType={doc.value}
                  label={doc.label}
                  required={doc.required}
                  existing={documents.find((d) => d.docType === doc.value)}
                  basePath={basePath}
                  onUploaded={refreshDocuments}
                />
              ))}

              {!submission && (
                <p className="text-sm text-ink-500">Uploads unlock once your details are submitted.</p>
              )}
            </CardBody>
          </Card>
        </>
      )}

      {data.history?.length > 0 && (
        <Card className="mt-4">
          <CardHeader title="Review history" />
          <CardBody>
            <ul className="space-y-2.5">
              {data.history.map((entry) => (
                <li key={entry.id} className="flex gap-3 text-base">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-ink-300" aria-hidden="true" />
                  <div className="min-w-0">
                    <p className="capitalize text-ink-800">{entry.to_status.replace('_', ' ')}</p>
                    {entry.notes && <p className="mt-0.5 text-sm text-ink-500">{entry.notes}</p>}
                    <p className="mt-0.5 text-xs text-ink-400">{formatDateTime(entry.created_at)}</p>
                  </div>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
