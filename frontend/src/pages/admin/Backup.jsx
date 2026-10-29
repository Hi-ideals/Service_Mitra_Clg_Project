import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  DatabaseBackup, Download, Users, CalendarRange, CreditCard, FileText,
  Wallet, Star, FileLock2, HardDriveDownload, Clock, ShieldAlert, Server, Images,
} from 'lucide-react';
import { api } from '../../lib/api.js';
import { keys } from '../../lib/queryClient.js';
import { useToast } from '../../context/ToastContext.jsx';
import Card, { CardBody, CardHeader } from '../../components/ui/Card.jsx';
import Alert from '../../components/ui/Alert.jsx';
import Badge from '../../components/ui/Badge.jsx';
import Button from '../../components/ui/Button.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import { PageLoader } from '../../components/ui/Spinner.jsx';
import { formatDateTime, timeAgo, pluralise } from '../../lib/format.js';
import useDocumentTitle from '../../hooks/useDocumentTitle.js';

/**
 * Backups.
 *
 * Two different things on one screen, kept visibly apart because confusing
 * them is expensive.
 *
 * The top half is a real backup: the whole database as pg_dump writes it, plus
 * an archive of the uploaded documents. Those two files can rebuild this
 * platform on a bare server.
 *
 * The bottom half is spreadsheets. Useful for reconciliation and for an
 * accountant; useless for restoring anything. An admin who believes a folder
 * of CSVs is a backup finds out on the day the disk dies, so the page never
 * calls them one.
 */
const DATASET_ICONS = {
  people: Users,
  bookings: CalendarRange,
  payments: CreditCard,
  invoices: FileText,
  payouts: Wallet,
  reviews: Star,
};

const KIND = {
  database: { icon: Server, label: 'Database' },
  files: { icon: Images, label: 'Documents' },
};

/** Bytes a person can read. Backups run to hundreds of megabytes. */
function size(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / 1024 ** i;
  return (i === 0 || value >= 100 ? Math.round(value) : value.toFixed(1)) + ' ' + units[i];
}

/** `2026-10-13-1432` is how the files are named; nobody should have to read that. */
function whenTaken(group) {
  const [y, m, d, time] = group.split('-');
  return new Date(`${y}-${m}-${d}T${time.slice(0, 2)}:${time.slice(2)}:00`);
}

export default function Backup() {
  useDocumentTitle('Backup');
  const toast = useToast();
  const queryClient = useQueryClient();

  // Which file is downloading, not a boolean: several can be asked for in
  // succession and only the clicked button should show the spinner.
  const [downloading, setDownloading] = useState(null);

  const { data, isLoading } = useQuery({
    queryKey: keys.admin.backup,
    queryFn: async () => (await api.get('/admin/backup/status')).data,
  });

  const runBackup = useMutation({
    mutationFn: () => api.post('/admin/backup/run'),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: keys.admin.backup });
      // The server's message, not a generic one: a run that backed up the
      // database but could not archive the documents is a partial success and
      // has to say so.
      toast.success(result?.message ?? 'Backup complete');
    },
    onError: (e) => toast.error(e.message),
  });

  async function download(path, filename) {
    setDownloading(filename);
    try {
      await api.download(path, { filename });
    } catch (e) {
      toast.error(e.message);
    } finally {
      setDownloading(null);
    }
  }

  if (isLoading) return <PageLoader label="Checking your backups" />;

  const { tools, runs = [], schedule, lastBackupAt, totalBytes } = data ?? {};
  const datasets = data?.exports?.datasets ?? [];

  return (
    <>
      <PageHeader
        icon={DatabaseBackup}
        title="Backup"
        description="A full copy of the database and the uploaded documents."
        action={
          <Button
            icon={HardDriveDownload}
            loading={runBackup.isPending}
            disabled={!tools?.ok}
            onClick={() => runBackup.mutate()}
          >
            Back up now
          </Button>
        }
      />

      {/* The one thing that must never be discovered later. If the tools are
          missing, the button above cannot work, and saying so here is the
          difference between finding out now and finding out during a
          disaster. */}
      {!tools?.ok && (
        <Alert variant="error" title="This server cannot take a backup" className="mt-4">
          {tools?.problem ?? 'pg_dump is not available.'} Until this is fixed, nothing on this page
          produces a restorable copy of your data.
        </Alert>
      )}

      <div className="mt-4 grid gap-3 lg:grid-cols-3">
        <Card>
          <CardBody className="flex items-start gap-3">
            <span className="icon-chip icon-chip-brand h-9 w-9 shrink-0">
              <Clock aria-hidden="true" className="h-[1.125rem] w-[1.125rem]" />
            </span>
            <div className="min-w-0">
              <p className="text-sm text-ink-500">Last backup</p>
              <p className="text-md font-semibold text-ink-900">
                {lastBackupAt ? timeAgo(lastBackupAt) : 'Never'}
              </p>
              {lastBackupAt && (
                <p className="mt-0.5 text-sm text-ink-500">{formatDateTime(lastBackupAt)}</p>
              )}
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardBody className="flex items-start gap-3">
            <span className="icon-chip icon-chip-brand h-9 w-9 shrink-0">
              <DatabaseBackup aria-hidden="true" className="h-[1.125rem] w-[1.125rem]" />
            </span>
            <div className="min-w-0">
              <p className="text-sm text-ink-500">Automatic backups</p>
              <p className="text-md font-semibold text-ink-900">
                {schedule?.enabled ? 'Every ' + pluralise(schedule.everyHours, 'hour') : 'Off'}
              </p>
              <p className="mt-0.5 text-sm text-ink-500">
                {schedule?.enabled
                  ? 'Keeping the last ' + pluralise(schedule.keep, 'copy', 'copies')
                  : 'Only the button above takes a backup.'}
              </p>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardBody className="flex items-start gap-3">
            <span className="icon-chip icon-chip-brand h-9 w-9 shrink-0">
              <Server aria-hidden="true" className="h-[1.125rem] w-[1.125rem]" />
            </span>
            <div className="min-w-0">
              <p className="text-sm text-ink-500">Stored on this server</p>
              <p className="text-md font-semibold text-ink-900">{size(totalBytes)}</p>
              <p className="mt-0.5 text-sm text-ink-500">
                {pluralise(runs.length, 'backup')} kept
              </p>
            </div>
          </CardBody>
        </Card>
      </div>

      {/* Said plainly, because it is the part that is usually got wrong: a
          backup that only exists on the machine it is backing up is not
          protection against losing that machine. */}
      <Alert variant="warning" title="Download a copy and keep it somewhere else" className="mt-3">
        These files sit on the same server as the data they protect. If that server is lost, they
        go with it. Download the latest pair regularly, or have your host copy this folder off the
        machine on a schedule.
      </Alert>

      <Card className="mt-3">
        <CardHeader
          icon={DatabaseBackup}
          title="Backups"
          subtitle="Each one is the database plus the uploaded documents. Keep both halves together."
        />
        <CardBody className="p-0">
          {runs.length === 0 ? (
            <EmptyState
              icon={DatabaseBackup}
              title="No backups yet"
              description={
                tools?.ok
                  ? 'Use "Back up now" above, or wait for the first scheduled run.'
                  : 'Backups cannot run until the problem above is fixed.'
              }
            />
          ) : (
            <ul className="divide-y divide-ink-200/80">
              {runs.map((run) => (
                <li
                  key={run.group}
                  className="flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:px-5"
                >
                  <div className="min-w-0">
                    <p className="font-medium text-ink-900">{formatDateTime(whenTaken(run.group))}</p>
                    <p className="mt-0.5 text-sm text-ink-500">
                      {timeAgo(run.takenAt)} · {size(run.bytes)}
                      {run.files.length < 2 && (
                        // Worth flagging rather than leaving to be noticed: a
                        // run missing its document archive restores to a
                        // platform where every KYC file is gone.
                        <> · <Badge variant="warning">database only</Badge></>
                      )}
                    </p>
                  </div>

                  <div className="flex shrink-0 flex-wrap gap-2">
                    {run.files.map((file) => {
                      const { icon: Icon, label } = KIND[file.kind] ?? KIND.database;
                      return (
                        <Button
                          key={file.name}
                          variant="secondary"
                          size="sm"
                          icon={Icon}
                          loading={downloading === file.name}
                          onClick={() => download('/admin/backup/file/' + file.name, file.name)}
                        >
                          {label} · {size(file.bytes)}
                        </Button>
                      );
                    })}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      {/* ---------- a different thing, kept visibly separate ---------- */}

      <Card className="mt-6">
        <CardHeader
          icon={FileText}
          title="Readable exports"
          subtitle="Spreadsheets for reconciliation and accounting. These do not restore anything."
        />
        <CardBody>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {datasets.map((set) => {
              const Icon = DATASET_ICONS[set.name] ?? FileText;
              const empty = set.rows === 0;

              return (
                <div
                  key={set.name}
                  className="flex flex-col gap-3 rounded-card p-3.5 ring-1 ring-inset ring-ink-200/80"
                >
                  <div className="flex min-w-0 items-start gap-3">
                    <span className="icon-chip h-9 w-9 shrink-0 bg-ink-100 text-ink-500">
                      <Icon aria-hidden="true" className="h-[1.125rem] w-[1.125rem]" />
                    </span>
                    <div className="min-w-0">
                      <h4 className="font-semibold text-ink-900">{set.label}</h4>
                      <p className="mt-0.5 text-sm text-ink-500">{set.description}</p>
                    </div>
                  </div>

                  <div className="mt-auto flex items-center justify-between gap-3">
                    <p className="text-sm font-medium text-ink-600">
                      {/* The count is here so the download can be checked
                          against something. A CSV of unknown expected length
                          tells you nothing when it arrives short. */}
                      {empty ? 'Nothing yet' : pluralise(set.rows, 'row')}
                    </p>
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={Download}
                      disabled={empty}
                      loading={downloading === 'servicemitra-' + set.name + '.csv'}
                      onClick={() =>
                        download('/admin/backup/export/' + set.name, 'servicemitra-' + set.name + '.csv')
                      }
                    >
                      CSV
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </CardBody>
      </Card>

      {/* Named rather than silently omitted, so nobody assumes the CSVs above
          cover the documents. The backup at the top of the page does. */}
      <Card className="mt-3">
        <CardBody className="flex items-start gap-3">
          <span className="icon-chip h-9 w-9 shrink-0 bg-ink-100 text-ink-500">
            <FileLock2 aria-hidden="true" className="h-[1.125rem] w-[1.125rem]" />
          </span>
          <div className="min-w-0">
            <h3 className="text-md font-semibold text-ink-900">Verification documents</h3>
            <p className="mt-0.5 text-sm text-ink-500">
              {pluralise(data?.exports?.kycDocuments ?? 0, 'file')} uploaded by providers - Aadhaar
              cards and photographs. They are files rather than records, so no CSV here includes
              them; they are covered by the document archive in each backup above.
            </p>
          </div>
        </CardBody>
      </Card>

      <p className="mt-4 flex items-start gap-2 text-sm text-ink-500">
        <ShieldAlert aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
        <span>
          A backup file holds every customer address, every bank detail and every password hash on
          this platform. Treat a downloaded copy as you would the server itself. Every download is
          recorded against the account that took it.
        </span>
      </p>
    </>
  );
}
